-- Internal recruitment master data: a requisition, published internal jobs
-- (including a gig posting for the talent marketplace), a job template, a
-- live application with its eligibility evaluation, a referral, assessments
-- and one employee's career interests. Sample data is editable working data.
SET @admin_id = (SELECT id FROM users WHERE email = 'admin@harene.com' LIMIT 1);
SET @dept_polish = (SELECT id FROM departments WHERE code = 'DEPT-POLISH' LIMIT 1);
SET @dept_asrt = (SELECT id FROM departments WHERE code = 'DEPT-ASRT' LIMIT 1);
SET @role_sr = (SELECT id FROM job_roles WHERE code = 'JR-SR-KARIGAR' LIMIT 1);
SET @role_asrt = (SELECT id FROM job_roles WHERE code = 'JR-ASSORTER' LIMIT 1);
SET @emp_301 = (SELECT id FROM employees WHERE emp_code = '301' LIMIT 1);
SET @emp_302 = (SELECT id FROM employees WHERE emp_code = '302' LIMIT 1);
SET @emp_303 = (SELECT id FROM employees WHERE emp_code = '303' LIMIT 1);
SET @emp_dhar = (SELECT id FROM employees WHERE emp_code = 'DHAR-401' LIMIT 1);

-- Requisition ------------------------------------------------------------------
INSERT INTO job_requisitions (req_code, requisition_type, title, department_id, job_role_id, headcount, justification, budget_amount, budget_approved, budget_approved_by, budget_approved_at, status, requested_by, approved_by, approved_at) VALUES
('REQ-2026-001', 'EXPANSION', 'Senior Karigar - Fancy Shapes', @dept_polish, @role_sr, 1, 'Princess-cut demand is outgrowing the current senior bench.', 780000.00, true, @admin_id, '2026-07-20 11:00:00', 'APPROVED', @admin_id, @admin_id, '2026-07-21 10:00:00')
ON DUPLICATE KEY UPDATE title = VALUES(title);

SET @req_1 = (SELECT id FROM job_requisitions WHERE req_code = 'REQ-2026-001' LIMIT 1);

-- Internal jobs ------------------------------------------------------------------
INSERT INTO internal_jobs (job_code, requisition_id, title, description, category, department_id, job_role_id, grade, location, work_mode, employment_type, openings, salary_range_min, salary_range_max, eligibility_rules, is_featured, status, published_at, expires_at, hiring_manager_employee_id, approved_by, approved_at, created_by) VALUES
('IJ-2026-001', @req_1, 'Senior Karigar - Fancy Shapes', 'Own the princess and marquise lots end to end on the senior bench. Mentors two junior karigars and signs off first-pass quality with assortment.', 'Polishing', @dept_polish, @role_sr, 'A+++', 'Surat - Varachha Unit', 'ONSITE', 'FULL_TIME', 1, 55000.00, 65000.00, '{"minTenureMonths": 24, "allowedGrades": ["A++", "A+++", "A*"], "minPerformanceRating": 3.5, "requiredSkills": ["Fancy shape polishing"], "maxNoticeDays": 30}', true, 'PUBLISHED', '2026-07-25 09:00:00', '2026-09-30 23:59:59', @emp_dhar, @admin_id, '2026-07-24 15:00:00', @admin_id),
('IJ-2026-002', NULL, 'QC Gig - Princess Batch Verification', 'Four-week gig assisting assortment with first-pass checks on the new princess line. Two hours a day alongside the current role.', 'Quality', @dept_asrt, @role_asrt, NULL, 'Surat - Varachha Unit', 'ONSITE', 'GIG', 2, NULL, NULL, '{"minTenureMonths": 6, "allowedGrades": [], "minPerformanceRating": null, "requiredSkills": [], "maxNoticeDays": null}', false, 'PUBLISHED', '2026-08-01 09:00:00', '2026-08-31 23:59:59', NULL, @admin_id, '2026-07-31 12:00:00', @admin_id),
('IJ-2026-003', NULL, 'Blocking Line Lead (Draft)', 'Draft posting for the blocking line lead role - pending requisition approval.', 'Blocking', (SELECT id FROM departments WHERE code = 'DEPT-BLOCK' LIMIT 1), NULL, 'A+', 'Surat - Varachha Unit', 'ONSITE', 'FULL_TIME', 1, NULL, NULL, NULL, false, 'DRAFT', NULL, NULL, NULL, NULL, NULL, @admin_id)
ON DUPLICATE KEY UPDATE title = VALUES(title);

SET @job_sr = (SELECT id FROM internal_jobs WHERE job_code = 'IJ-2026-001' LIMIT 1);
SET @job_gig = (SELECT id FROM internal_jobs WHERE job_code = 'IJ-2026-002' LIMIT 1);

INSERT INTO internal_job_templates (code, name, title_template, description_template, category, work_mode, employment_type, eligibility_rules, is_active, created_by) VALUES
('TPL-KARIGAR', 'Karigar bench posting', 'Karigar - {shape} specialist', 'Bench role polishing {shape} lots to first-pass standard.', 'Polishing', 'ONSITE', 'FULL_TIME', '{"minTenureMonths": 12, "allowedGrades": [], "minPerformanceRating": null, "requiredSkills": [], "maxNoticeDays": 30}', true, @admin_id)
ON DUPLICATE KEY UPDATE name = VALUES(name);

INSERT INTO saved_jobs (employee_id, job_id, is_favorite) VALUES
(@emp_301, @job_gig, true)
ON DUPLICATE KEY UPDATE is_favorite = VALUES(is_favorite);

-- Application with its eligibility evaluation ---------------------------------------
INSERT INTO internal_applications (job_id, employee_id, status, cover_letter, expected_notice_days, eligibility_result, eligibility_passed, submitted_at) VALUES
(@job_sr, @emp_302, 'UNDER_REVIEW', 'I have led the princess-cut qualification effort this year and want to take the senior bench full time.', 15, '[{"rule": "minTenureMonths", "pass": true, "detail": "73 months of service against a 24-month requirement"}, {"rule": "allowedGrades", "pass": true, "detail": "Grade A+++ is in the allowed list"}, {"rule": "minPerformanceRating", "pass": true, "detail": "Final rating 4.4 against a 3.5 requirement"}, {"rule": "requiredSkills", "pass": true, "detail": "Fancy shape polishing recorded in the skills profile"}, {"rule": "maxNoticeDays", "pass": true, "detail": "15 days expected against a 30-day limit"}]', true, '2026-08-02 10:30:00')
ON DUPLICATE KEY UPDATE status = VALUES(status);

SET @app_1 = (SELECT id FROM internal_applications WHERE job_id = @job_sr AND employee_id = @emp_302 LIMIT 1);

INSERT INTO application_stage_events (application_id, from_status, to_status, note, created_by)
SELECT @app_1, NULL, 'SUBMITTED', 'Application submitted through the internal portal', @admin_id
WHERE NOT EXISTS (SELECT 1 FROM application_stage_events WHERE application_id = @app_1 AND to_status = 'SUBMITTED');

INSERT INTO application_stage_events (application_id, from_status, to_status, note, created_by)
SELECT @app_1, 'SUBMITTED', 'UNDER_REVIEW', 'Picked up for HR screening', @admin_id
WHERE NOT EXISTS (SELECT 1 FROM application_stage_events WHERE application_id = @app_1 AND to_status = 'UNDER_REVIEW');

-- Referral --------------------------------------------------------------------------
INSERT INTO referrals (job_id, referrer_employee_id, referred_employee_id, note, status)
SELECT @job_gig, @emp_303, @emp_301, 'Jayesh has the steadiest first-pass record on rounds and wants QC exposure.', 'SUBMITTED'
WHERE NOT EXISTS (SELECT 1 FROM referrals WHERE job_id = @job_gig AND referrer_employee_id = @emp_303);

-- Assessments -------------------------------------------------------------------------
INSERT INTO assessments (code, name, assessment_type, description, max_score, pass_score, duration_minutes, is_active, created_by) VALUES
('ASM-POLISH', 'Practical Polishing Test', 'SKILL', 'Supervised bench test: one princess stone from block to final polish, scored on symmetry, finish and time.', 100.00, 70.00, 180, true, @admin_id),
('ASM-QC', 'Quality Inspection Aptitude', 'APTITUDE', 'Grading exercise across 20 reference stones with known defects.', 100.00, 75.00, 60, true, @admin_id)
ON DUPLICATE KEY UPDATE name = VALUES(name);

-- Career interests -----------------------------------------------------------------------
INSERT INTO career_interests (employee_id, preferred_roles, preferred_departments, work_mode_preference, willing_to_relocate, open_to_gigs, career_statement, updated_by) VALUES
(@emp_302, '["Senior Karigar", "Line Lead"]', '["Polishing"]', 'ONSITE', false, true, 'Grow into the senior fancy-shapes bench and eventually lead a line.', @admin_id)
ON DUPLICATE KEY UPDATE career_statement = VALUES(career_statement);
