-- Performance management master data: cycles, review template, competency
-- framework, KPI/KRA libraries, goal templates, and a light layer of sample
-- goals/OKRs/assignments so every screen has something real to show.
-- Sample targets are editable working data, not commitments.
SET @admin_id = (SELECT id FROM users WHERE email = 'admin@harene.com' LIMIT 1);
SET @dept_polish = (SELECT id FROM departments WHERE code = 'DEPT-POLISH' LIMIT 1);
SET @dept_block = (SELECT id FROM departments WHERE code = 'DEPT-BLOCK' LIMIT 1);
SET @emp_301 = (SELECT id FROM employees WHERE emp_code = '301' LIMIT 1);
SET @emp_302 = (SELECT id FROM employees WHERE emp_code = '302' LIMIT 1);
SET @emp_303 = (SELECT id FROM employees WHERE emp_code = '303' LIMIT 1);
SET @emp_304 = (SELECT id FROM employees WHERE emp_code = '304' LIMIT 1);
SET @emp_dhar = (SELECT id FROM employees WHERE emp_code = 'DHAR-401' LIMIT 1);

-- Performance cycles ---------------------------------------------------------
INSERT INTO perf_cycles (code, name, cycle_type, financial_year, start_date, end_date, goal_setting_start, goal_setting_end, self_review_start, self_review_end, manager_review_start, manager_review_end, calibration_start, calibration_end, status, description, created_by) VALUES
('PERF-FY26', 'Annual Cycle FY 2026-27', 'ANNUAL', '2026-2027', '2026-04-01', '2027-03-31', '2026-04-01', '2026-04-30', '2027-02-01', '2027-02-28', '2027-03-01', '2027-03-20', '2027-03-21', '2027-03-31', 'ACTIVE', 'Company-wide annual performance cycle', @admin_id),
('PERF-Q2-FY26', 'Quarterly Review Jul-Sep 2026', 'QUARTERLY', '2026-2027', '2026-07-01', '2026-09-30', '2026-07-01', '2026-07-10', '2026-09-20', '2026-09-25', '2026-09-26', '2026-09-30', NULL, NULL, 'ACTIVE', 'Q2 check-in cycle for the factory floor', @admin_id)
ON DUPLICATE KEY UPDATE name = VALUES(name);

SET @cycle_fy = (SELECT id FROM perf_cycles WHERE code = 'PERF-FY26' LIMIT 1);
SET @cycle_q2 = (SELECT id FROM perf_cycles WHERE code = 'PERF-Q2-FY26' LIMIT 1);

-- Review template --------------------------------------------------------------
INSERT INTO review_templates (code, name, applies_to, rating_scale, sections_json, is_active, created_by) VALUES
('TPL-STD', 'Standard Review Form', 'ALL', 5, '[{"section":"Achievements","questions":[{"kind":"TEXT","question":"What were the key achievements this cycle?"},{"kind":"TEXT","question":"Which goals were completed and which slipped?"}]},{"section":"Ratings","questions":[{"kind":"RATING","question":"Overall quality of work"},{"kind":"RATING","question":"Productivity against targets"},{"kind":"RATING","question":"Discipline, attendance and safety"}]},{"section":"Development","questions":[{"kind":"TEXT","question":"What skills should be developed next cycle?"},{"kind":"TEXT","question":"What support is needed from the manager?"}]}]', true, @admin_id),
('TPL-PEER', 'Peer Feedback Form', 'PEER', 5, '[{"section":"Collaboration","questions":[{"kind":"RATING","question":"Collaboration and helpfulness"},{"kind":"RATING","question":"Contribution to team output"},{"kind":"TEXT","question":"One thing this colleague does well"},{"kind":"TEXT","question":"One thing this colleague could improve"}]}]', true, @admin_id)
ON DUPLICATE KEY UPDATE name = VALUES(name);

SET @tpl_std = (SELECT id FROM review_templates WHERE code = 'TPL-STD' LIMIT 1);

-- Competency framework ----------------------------------------------------------
INSERT INTO competencies (code, name, category, description, is_active) VALUES
('POLISH-PREC', 'Polishing Precision', 'TECHNICAL', 'Accuracy of facets, symmetry and finish on the wheel', true),
('PLANNING', 'Stone Planning', 'TECHNICAL', 'Reading the rough and planning cuts for maximum yield', true),
('QC-INSPECT', 'Quality Inspection', 'FUNCTIONAL', 'Spotting inclusions, rework triggers and grade drift', true),
('EQUIP-CARE', 'Equipment Care', 'FUNCTIONAL', 'Maintenance and careful handling of wheels and tools', true),
('TEAM-LEAD', 'Team Leadership', 'LEADERSHIP', 'Running a bench line, allocating lots, unblocking others', true),
('MENTORING', 'Mentoring', 'LEADERSHIP', 'Coaching junior karigars into higher grades', true),
('SAFETY-DISC', 'Discipline & Safety', 'BEHAVIORAL', 'Punctuality, safe handling and process discipline', true),
('COMMUNICATION', 'Communication', 'BEHAVIORAL', 'Clear updates on lot status, issues raised early', true)
ON DUPLICATE KEY UPDATE name = VALUES(name);

-- KPI library --------------------------------------------------------------------
INSERT INTO kpi_library (code, name, description, category, unit, direction, auto_source, is_active, created_by) VALUES
('PIECES-MONTH', 'Pieces Polished per Month', 'Verified pieces completed in the month, from lot receipts', 'PRODUCTION', 'pieces', 'HIGHER_BETTER', 'PRODUCTION_PIECES', true, @admin_id),
('PROD-VALUE', 'Production Labour Value', 'Labour value of verified production, from the ledger', 'PRODUCTION', 'INR', 'HIGHER_BETTER', 'PRODUCTION_VALUE', true, @admin_id),
('ATT-PCT', 'Attendance Percentage', 'Worked days against expected working days', 'ATTENDANCE', '%', 'HIGHER_BETTER', 'ATTENDANCE_PCT', true, @admin_id),
('OT-HOURS', 'Overtime Hours', 'Overtime burden - lower is healthier at steady output', 'ATTENDANCE', 'hours', 'LOWER_BETTER', 'OT_HOURS', true, @admin_id),
('QUALITY-GRADE', 'Quality Grade Score', 'Manual quality score from assortment checks (1-5)', 'QUALITY', 'score', 'HIGHER_BETTER', 'NONE', true, @admin_id),
('FIRST-PASS', 'First Pass Rate', 'Share of lots accepted without rework, entered monthly', 'QUALITY', '%', 'HIGHER_BETTER', 'NONE', true, @admin_id)
ON DUPLICATE KEY UPDATE name = VALUES(name);

SET @kpi_pieces = (SELECT id FROM kpi_library WHERE code = 'PIECES-MONTH' LIMIT 1);
SET @kpi_value = (SELECT id FROM kpi_library WHERE code = 'PROD-VALUE' LIMIT 1);
SET @kpi_att = (SELECT id FROM kpi_library WHERE code = 'ATT-PCT' LIMIT 1);
SET @kpi_quality = (SELECT id FROM kpi_library WHERE code = 'QUALITY-GRADE' LIMIT 1);

-- KRA library ---------------------------------------------------------------------
INSERT INTO kra_library (code, name, description, department_id, default_weightage_pct, is_active, created_by) VALUES
('KRA-OUTPUT', 'Polishing Output', 'Deliver monthly piece targets across assigned shapes', @dept_polish, 35.00, true, @admin_id),
('KRA-QUALITY', 'Quality Standards', 'Hold grade and finish standards with minimal rework', @dept_polish, 30.00, true, @admin_id),
('KRA-DISCIPLINE', 'Attendance & Discipline', 'Attendance, punctuality and safe working practices', NULL, 20.00, true, @admin_id),
('KRA-MAINTENANCE', 'Machine & Tool Care', 'Keep wheels and tools maintained and report faults early', NULL, 15.00, true, @admin_id)
ON DUPLICATE KEY UPDATE name = VALUES(name);

SET @kra_output = (SELECT id FROM kra_library WHERE code = 'KRA-OUTPUT' LIMIT 1);
SET @kra_quality = (SELECT id FROM kra_library WHERE code = 'KRA-QUALITY' LIMIT 1);
SET @kra_disc = (SELECT id FROM kra_library WHERE code = 'KRA-DISCIPLINE' LIMIT 1);

-- Goal templates --------------------------------------------------------------------
INSERT INTO goal_templates (code, name, kind, scope, category, title_template, description_template, metric_name, metric_unit, suggested_weightage_pct, is_active, created_by) VALUES
('GT-PIECES', 'Monthly piece target', 'GOAL', 'INDIVIDUAL', 'Production', 'Polish {target} verified pieces this cycle', 'Counted from verified lot receipts only.', 'Verified pieces', 'pieces', 40.00, true, @admin_id),
('GT-QUALITY', 'Quality improvement', 'GOAL', 'INDIVIDUAL', 'Quality', 'Hold first-pass rate above {target}%', 'Measured by assortment acceptance without rework.', 'First pass rate', '%', 30.00, true, @admin_id),
('GT-SKILL', 'Learn a new shape', 'GOAL', 'INDIVIDUAL', 'Development', 'Qualify on {shape} polishing', 'Certified by the floor manager after a supervised batch.', NULL, NULL, 15.00, true, @admin_id)
ON DUPLICATE KEY UPDATE name = VALUES(name);

-- Sample company OKR: one objective, three key results ------------------------------
INSERT INTO perf_goals (cycle_id, kind, scope, title, description, metric_name, metric_unit, start_value, target_value, current_value, weightage_pct, progress_pct, progress_mode, status, priority, visibility, due_date, created_by) VALUES
(@cycle_fy, 'OBJECTIVE', 'ORGANIZATION', 'Lift factory output without sacrificing grade', 'FY 2026-27 company objective for the Surat unit.', NULL, NULL, NULL, NULL, NULL, 100.00, 0.00, 'CHILDREN', 'ACTIVE', 'HIGH', 'ORGANIZATION', '2027-03-31', @admin_id)
ON DUPLICATE KEY UPDATE title = VALUES(title);

SET @okr_obj = (SELECT id FROM perf_goals WHERE title = 'Lift factory output without sacrificing grade' AND cycle_id = @cycle_fy LIMIT 1);

INSERT INTO perf_goals (cycle_id, kind, scope, parent_goal_id, title, metric_name, metric_unit, start_value, target_value, current_value, weightage_pct, progress_pct, progress_mode, status, priority, visibility, due_date, created_by) VALUES
(@cycle_fy, 'KEY_RESULT', 'ORGANIZATION', @okr_obj, 'Raise monthly verified pieces from 850 to 1000', 'Verified pieces per month', 'pieces', 850.00, 1000.00, 880.00, 40.00, 20.00, 'METRIC', 'ACTIVE', 'HIGH', 'ORGANIZATION', '2027-03-31', @admin_id),
(@cycle_fy, 'KEY_RESULT', 'ORGANIZATION', @okr_obj, 'Hold first-pass acceptance at 95% or better', 'First pass rate', '%', 92.00, 95.00, 93.00, 35.00, 33.33, 'METRIC', 'ACTIVE', 'HIGH', 'ORGANIZATION', '2027-03-31', @admin_id),
(@cycle_fy, 'KEY_RESULT', 'ORGANIZATION', @okr_obj, 'Qualify three karigars on princess cuts', 'Karigars qualified', 'people', 0.00, 3.00, 1.00, 25.00, 33.33, 'METRIC', 'ACTIVE', 'MEDIUM', 'ORGANIZATION', '2027-03-31', @admin_id)
ON DUPLICATE KEY UPDATE title = VALUES(title);

-- Department goal cascaded from the objective, and individual goals under it --------
INSERT INTO perf_goals (cycle_id, kind, scope, department_id, parent_goal_id, title, description, metric_name, metric_unit, start_value, target_value, current_value, weightage_pct, progress_pct, progress_mode, status, priority, visibility, due_date, created_by) VALUES
(@cycle_fy, 'GOAL', 'DEPARTMENT', @dept_polish, @okr_obj, 'Polishing: 700 verified pieces per month by Q4', 'Department share of the company output objective.', 'Verified pieces per month', 'pieces', 600.00, 700.00, 615.00, 100.00, 15.00, 'METRIC', 'ACTIVE', 'HIGH', 'ORGANIZATION', '2027-03-31', @admin_id)
ON DUPLICATE KEY UPDATE title = VALUES(title);

SET @goal_dept = (SELECT id FROM perf_goals WHERE title = 'Polishing: 700 verified pieces per month by Q4' LIMIT 1);

INSERT INTO perf_goals (cycle_id, kind, scope, employee_id, parent_goal_id, title, description, metric_name, metric_unit, start_value, target_value, current_value, weightage_pct, progress_pct, progress_mode, status, priority, visibility, due_date, created_by) VALUES
(@cycle_fy, 'GOAL', 'INDIVIDUAL', @emp_301, @goal_dept, 'Polish 95 verified pieces per month', 'Personal share of the polishing department target.', 'Verified pieces', 'pieces', 80.00, 95.00, 84.00, 40.00, 26.67, 'METRIC', 'ACTIVE', 'HIGH', 'MANAGER', '2027-03-31', @admin_id),
(@cycle_fy, 'GOAL', 'INDIVIDUAL', @emp_302, @goal_dept, 'Qualify on princess cuts and take fancy lots', 'Supervised princess batch signed off by the floor manager.', NULL, NULL, NULL, NULL, NULL, 30.00, 40.00, 'MILESTONES', 'ACTIVE', 'MEDIUM', 'MANAGER', '2026-12-31', @admin_id),
(@cycle_fy, 'GOAL', 'INDIVIDUAL', @emp_303, @goal_dept, 'Keep first-pass rate above 95%', 'Assortment acceptance without rework, tracked monthly.', 'First pass rate', '%', 91.00, 95.00, 93.00, 35.00, 50.00, 'METRIC', 'ACTIVE', 'HIGH', 'MANAGER', '2027-03-31', @admin_id),
(@cycle_fy, 'GOAL', 'INDIVIDUAL', @emp_304, NULL, 'Reduce average rework turnaround to 2 days', 'Awaiting manager approval before it becomes active.', 'Turnaround', 'days', 4.00, 2.00, NULL, 20.00, 0.00, 'MANUAL', 'PENDING_APPROVAL', 'MEDIUM', 'MANAGER', '2026-12-31', @admin_id)
ON DUPLICATE KEY UPDATE title = VALUES(title);

SET @goal_302 = (SELECT id FROM perf_goals WHERE employee_id = @emp_302 AND title = 'Qualify on princess cuts and take fancy lots' LIMIT 1);

INSERT INTO goal_milestones (goal_id, title, due_date, status, completed_at, sort_order) VALUES
(@goal_302, 'Shadow senior karigar on a princess lot', '2026-08-15', 'COMPLETED', '2026-08-01 10:00:00', 1),
(@goal_302, 'Complete supervised batch of 10 stones', '2026-10-15', 'PENDING', NULL, 2),
(@goal_302, 'Independent sign-off by floor manager', '2026-12-15', 'PENDING', NULL, 3)
ON DUPLICATE KEY UPDATE title = VALUES(title);

-- Employee KRAs for the annual cycle -------------------------------------------------
INSERT INTO employee_kras (kra_id, employee_id, cycle_id, weightage_pct, self_score, manager_score, final_score, status, created_by) VALUES
(@kra_output, @emp_301, @cycle_fy, 35.00, NULL, NULL, NULL, 'ASSIGNED', @admin_id),
(@kra_quality, @emp_301, @cycle_fy, 30.00, NULL, NULL, NULL, 'ASSIGNED', @admin_id),
(@kra_disc, @emp_301, @cycle_fy, 20.00, NULL, NULL, NULL, 'ASSIGNED', @admin_id),
(@kra_output, @emp_302, @cycle_fy, 35.00, 4.00, NULL, NULL, 'SELF_SCORED', @admin_id),
(@kra_quality, @emp_302, @cycle_fy, 30.00, 4.50, NULL, NULL, 'SELF_SCORED', @admin_id)
ON DUPLICATE KEY UPDATE weightage_pct = VALUES(weightage_pct);

-- KPI assignments ----------------------------------------------------------------------
INSERT INTO kpi_assignments (kpi_id, cycle_id, scope, employee_id, department_id, weightage_pct, target_value, threshold_value, stretch_value, status, created_by) VALUES
(@kpi_value, @cycle_fy, 'ORGANIZATION', NULL, NULL, 100.00, 3000000.00, 2400000.00, 3600000.00, 'ACTIVE', @admin_id),
(@kpi_pieces, @cycle_fy, 'DEPARTMENT', NULL, @dept_polish, 100.00, 700.00, 600.00, 800.00, 'ACTIVE', @admin_id),
(@kpi_pieces, @cycle_fy, 'INDIVIDUAL', @emp_301, NULL, 40.00, 95.00, 80.00, 110.00, 'ACTIVE', @admin_id),
(@kpi_pieces, @cycle_fy, 'INDIVIDUAL', @emp_302, NULL, 40.00, 85.00, 70.00, 100.00, 'ACTIVE', @admin_id),
(@kpi_att, @cycle_fy, 'INDIVIDUAL', @emp_301, NULL, 30.00, 95.00, 85.00, 100.00, 'ACTIVE', @admin_id),
(@kpi_quality, @cycle_fy, 'INDIVIDUAL', @emp_303, NULL, 30.00, 4.50, 3.50, 5.00, 'ACTIVE', @admin_id)
ON DUPLICATE KEY UPDATE weightage_pct = VALUES(weightage_pct);

-- Review requests for the quarterly cycle ------------------------------------------------
INSERT INTO perf_reviews (cycle_id, employee_id, review_type, reviewer_employee_id, template_id, status, due_date, requested_by) VALUES
(@cycle_q2, @emp_301, 'SELF', @emp_301, @tpl_std, 'REQUESTED', '2026-09-25', @admin_id),
(@cycle_q2, @emp_302, 'SELF', @emp_302, @tpl_std, 'REQUESTED', '2026-09-25', @admin_id),
(@cycle_q2, @emp_301, 'MANAGER', @emp_dhar, @tpl_std, 'REQUESTED', '2026-09-30', @admin_id),
(@cycle_q2, @emp_302, 'MANAGER', @emp_dhar, @tpl_std, 'REQUESTED', '2026-09-30', @admin_id)
ON DUPLICATE KEY UPDATE due_date = VALUES(due_date);

-- Talent pool ----------------------------------------------------------------------------
INSERT INTO talent_pools (code, name, pool_type, description, is_active, created_by) VALUES
('POOL-HIPO', 'High Potential Karigars', 'HIPO', 'Karigars showing grade-jump potential within two cycles', true, @admin_id),
('POOL-LEAD', 'Future Line Leads', 'LEADERSHIP', 'Candidates to run a bench line or shift', true, @admin_id)
ON DUPLICATE KEY UPDATE name = VALUES(name);

SET @pool_hipo = (SELECT id FROM talent_pools WHERE code = 'POOL-HIPO' LIMIT 1);

INSERT INTO talent_pool_members (pool_id, employee_id, note, added_by) VALUES
(@pool_hipo, @emp_302, 'Fastest learner on fancy shapes this year', @admin_id)
ON DUPLICATE KEY UPDATE note = VALUES(note);

-- Continuous feedback and recognition samples ----------------------------------------------
INSERT INTO continuous_feedback (to_employee_id, from_user_id, feedback_type, message, visibility, is_anonymous) VALUES
(@emp_302, @admin_id, 'APPRECIATION', 'Princess batch came out clean on the first pass. Well done.', 'PUBLIC', false),
(@emp_304, @admin_id, 'COACHING', 'Watch the girdle thickness on rounds - two lots drifted this week.', 'MANAGER', false)
ON DUPLICATE KEY UPDATE message = VALUES(message);

INSERT INTO recognitions (employee_id, award_type, title, citation, points, is_public, awarded_by, awarded_at) VALUES
(@emp_302, 'SPOT', 'Clean First Pass - July', 'Zero rework across all July lots.', 100, true, @admin_id, '2026-08-01')
ON DUPLICATE KEY UPDATE title = VALUES(title);

SET @recog_1 = (SELECT id FROM recognitions WHERE employee_id = @emp_302 AND title = 'Clean First Pass - July' LIMIT 1);

INSERT INTO reward_ledger (employee_id, entry_type, points, recognition_id, reference, created_by)
SELECT @emp_302, 'EARNED', 100, @recog_1, 'Clean First Pass - July', @admin_id
WHERE NOT EXISTS (SELECT 1 FROM reward_ledger WHERE recognition_id = @recog_1 AND entry_type = 'EARNED');
