-- Seed the normalized organization and backfill the employee links from the
-- free-text columns that were the only org data until now.
SET @admin_id = (SELECT id FROM users WHERE email = 'admin@harene.com' LIMIT 1);

-- Company and legal entity -----------------------------------------------------
INSERT INTO companies
  (code, name, short_name, company_type, industry_type, registration_no, gstin, pan, incorporated_on,
   fiscal_year_start_month, base_currency, default_language, default_timezone, country,
   corporate_address, contact_email, contact_phone, is_payroll_company, status, created_by)
VALUES
('HARENE', 'Harene Diamond Pvt Ltd', 'Harene', 'STANDALONE', 'Diamond Manufacturing', 'U36911GJ2015PTC084521',
 '24AABCH1234M1Z5', 'AABCH1234M', '2015-06-18', 4, 'INR', 'en', 'Asia/Kolkata', 'IN',
 'Plot 42, Mini Bazaar, Varachha Road, Surat, Gujarat 395006', 'info@harene.com', '+91-261-2345678',
 true, 'ACTIVE', @admin_id)
ON DUPLICATE KEY UPDATE name = VALUES(name);

SET @company_id = (SELECT id FROM companies WHERE code = 'HARENE' LIMIT 1);

INSERT INTO legal_entities (company_id, code, name, entity_type, registration_no, gstin, country, state, registered_address, currency, is_payroll_entity, created_by)
VALUES (@company_id, 'HARENE-LE1', 'Harene Diamond Private Limited', 'PRIVATE_LIMITED', 'U36911GJ2015PTC084521',
        '24AABCH1234M1Z5', 'IN', 'Gujarat', 'Plot 42, Mini Bazaar, Varachha Road, Surat, Gujarat 395006', 'INR', true, @admin_id)
ON DUPLICATE KEY UPDATE name = VALUES(name);

SET @entity_id = (SELECT id FROM legal_entities WHERE code = 'HARENE-LE1' LIMIT 1);

-- Regions ----------------------------------------------------------------------
INSERT INTO regions (code, name, region_type, country, created_by) VALUES
('IN', 'India', 'COUNTRY', 'IN', @admin_id)
ON DUPLICATE KEY UPDATE name = VALUES(name);
SET @region_in = (SELECT id FROM regions WHERE code = 'IN' LIMIT 1);

INSERT INTO regions (code, name, region_type, parent_region_id, country, created_by) VALUES
('IN-GJ', 'Gujarat', 'STATE', @region_in, 'IN', @admin_id),
('IN-WEST', 'West Zone', 'ZONE', @region_in, 'IN', @admin_id)
ON DUPLICATE KEY UPDATE name = VALUES(name);
SET @region_west = (SELECT id FROM regions WHERE code = 'IN-WEST' LIMIT 1);

-- Branch and locations ---------------------------------------------------------
INSERT INTO branches
  (company_id, region_id, code, name, branch_type, address, city, state, country, postal_code,
   latitude, longitude, timezone, currency, language, contact_phone, opened_on, created_by)
VALUES
(@company_id, @region_west, 'SURAT', 'Surat Factory', 'FACTORY',
 'Plot 42, Mini Bazaar, Varachha Road', 'Surat', 'Gujarat', 'IN', '395006',
 21.2049000, 72.8397000, 'Asia/Kolkata', 'INR', 'en', '+91-261-2345678', '2015-07-01', @admin_id)
ON DUPLICATE KEY UPDATE name = VALUES(name);

SET @branch_surat = (SELECT id FROM branches WHERE code = 'SURAT' LIMIT 1);

INSERT INTO locations (company_id, branch_id, code, name, location_type, city, country, timezone, capacity, created_by) VALUES
(@company_id, @branch_surat, 'SURAT-POL2', 'Polishing Floor 2', 'MANUFACTURING_UNIT', 'Surat', 'IN', 'Asia/Kolkata', 60, @admin_id),
(@company_id, @branch_surat, 'SURAT-BLK', 'Blocking Bay', 'MANUFACTURING_UNIT', 'Surat', 'IN', 'Asia/Kolkata', 24, @admin_id),
(@company_id, @branch_surat, 'SURAT-ASRT', 'Assortment Hall', 'WORK_SITE', 'Surat', 'IN', 'Asia/Kolkata', 20, @admin_id),
(@company_id, @branch_surat, 'SURAT-OFF', 'Administration Office', 'OFFICE', 'Surat', 'IN', 'Asia/Kolkata', 15, @admin_id)
ON DUPLICATE KEY UPDATE name = VALUES(name);

-- Business unit and divisions ---------------------------------------------------
INSERT INTO business_units (company_id, code, name, description, annual_budget, created_by) VALUES
(@company_id, 'BU-MFG', 'Manufacturing', 'Rough to polished diamond manufacturing', 48000000.00, @admin_id)
ON DUPLICATE KEY UPDATE name = VALUES(name);
SET @bu_mfg = (SELECT id FROM business_units WHERE code = 'BU-MFG' LIMIT 1);

INSERT INTO divisions (company_id, business_unit_id, code, name, division_type, created_by) VALUES
(@company_id, @bu_mfg, 'DIV-POL', 'Polishing', 'OPERATIONAL', @admin_id),
(@company_id, @bu_mfg, 'DIV-BLK', 'Blocking', 'OPERATIONAL', @admin_id),
(@company_id, @bu_mfg, 'DIV-ASRT', 'Assortment', 'OPERATIONAL', @admin_id),
(@company_id, @bu_mfg, 'DIV-SUP', 'Shared Services', 'SHARED_SERVICE', @admin_id)
ON DUPLICATE KEY UPDATE name = VALUES(name);

-- Cost centres -------------------------------------------------------------------
INSERT INTO cost_center_groups (company_id, code, name, description, created_by) VALUES
(@company_id, 'CCG-MFG', 'Manufacturing centres', 'Direct production cost centres', @admin_id),
(@company_id, 'CCG-ADM', 'Administrative centres', 'Overhead and support', @admin_id)
ON DUPLICATE KEY UPDATE name = VALUES(name);
SET @ccg_mfg = (SELECT id FROM cost_center_groups WHERE code = 'CCG-MFG' LIMIT 1);
SET @ccg_adm = (SELECT id FROM cost_center_groups WHERE code = 'CCG-ADM' LIMIT 1);

INSERT INTO cost_centers (company_id, group_id, code, name, center_type, branch_id, gl_account, annual_budget, fiscal_year, created_by) VALUES
(@company_id, @ccg_mfg, 'CC-POLISH-01', 'Polishing floor', 'COST', @branch_surat, '5001', 26000000.00, 'FY2026-27', @admin_id),
(@company_id, @ccg_mfg, 'CC-BLOCK-01', 'Blocking line', 'COST', @branch_surat, '5002', 9000000.00, 'FY2026-27', @admin_id),
(@company_id, @ccg_mfg, 'CC-ASRT-01', 'Assortment', 'COST', @branch_surat, '5003', 4000000.00, 'FY2026-27', @admin_id),
(@company_id, @ccg_adm, 'CC-ADMIN-01', 'Administration', 'EXPENSE', @branch_surat, '6001', 6000000.00, 'FY2026-27', @admin_id)
ON DUPLICATE KEY UPDATE name = VALUES(name);

-- Departments, matching the free-text values already on employees ---------------
SET @div_pol = (SELECT id FROM divisions WHERE code = 'DIV-POL' LIMIT 1);
SET @div_blk = (SELECT id FROM divisions WHERE code = 'DIV-BLK' LIMIT 1);
SET @div_asrt = (SELECT id FROM divisions WHERE code = 'DIV-ASRT' LIMIT 1);
SET @cc_polish = (SELECT id FROM cost_centers WHERE code = 'CC-POLISH-01' LIMIT 1);
SET @cc_block = (SELECT id FROM cost_centers WHERE code = 'CC-BLOCK-01' LIMIT 1);
SET @cc_asrt = (SELECT id FROM cost_centers WHERE code = 'CC-ASRT-01' LIMIT 1);

INSERT INTO departments (company_id, division_id, code, name, cost_center_id, description, annual_budget, planned_headcount, created_by) VALUES
(@company_id, @div_pol, 'DEPT-POLISH', 'Polishing', @cc_polish, 'Wheel polishing of round and fancy shapes', 26000000.00, 14, @admin_id),
(@company_id, @div_blk, 'DEPT-BLOCK', 'Blocking', @cc_block, 'Initial blocking of rough stones', 9000000.00, 6, @admin_id),
(@company_id, @div_asrt, 'DEPT-ASRT', 'Assortment', @cc_asrt, 'Grading and sorting', 4000000.00, 4, @admin_id)
ON DUPLICATE KEY UPDATE name = VALUES(name);

-- Job architecture ----------------------------------------------------------------
INSERT INTO job_families (code, name, description) VALUES
('JF-MFG', 'Manufacturing', 'Hands-on diamond manufacturing trades'),
('JF-QC', 'Quality', 'Grading, inspection and assortment'),
('JF-ADM', 'Administration', 'Support and office functions')
ON DUPLICATE KEY UPDATE name = VALUES(name);
SET @jf_mfg = (SELECT id FROM job_families WHERE code = 'JF-MFG' LIMIT 1);
SET @jf_qc = (SELECT id FROM job_families WHERE code = 'JF-QC' LIMIT 1);

INSERT INTO job_functions (job_family_id, code, name) VALUES
(@jf_mfg, 'JFN-POLISH', 'Polishing'),
(@jf_mfg, 'JFN-BLOCK', 'Blocking'),
(@jf_qc, 'JFN-ASRT', 'Assortment')
ON DUPLICATE KEY UPDATE name = VALUES(name);

-- Grades mirror the existing employee grade values so nothing is orphaned.
INSERT INTO job_grades (code, name, rank_order, min_salary, max_salary) VALUES
('B', 'Grade B', 1, 14000.00, 20000.00),
('A', 'Grade A', 2, 18000.00, 26000.00),
('A+', 'Grade A+', 3, 22000.00, 32000.00),
('A++', 'Grade A++', 4, 26000.00, 38000.00),
('A+++', 'Grade A+++', 5, 30000.00, 45000.00),
('A*', 'Grade A star', 6, 35000.00, 55000.00)
ON DUPLICATE KEY UPDATE name = VALUES(name);

INSERT INTO job_levels (code, name, rank_order, career_stage) VALUES
('L1', 'Trainee', 1, 'ENTRY'),
('L2', 'Junior', 2, 'JUNIOR'),
('L3', 'Karigar', 3, 'MID'),
('L4', 'Senior Karigar', 4, 'SENIOR'),
('L5', 'Lead', 5, 'LEAD'),
('L6', 'Supervisor', 6, 'MANAGEMENT')
ON DUPLICATE KEY UPDATE name = VALUES(name);

SET @jfn_polish = (SELECT id FROM job_functions WHERE code = 'JFN-POLISH' LIMIT 1);
SET @jfn_block = (SELECT id FROM job_functions WHERE code = 'JFN-BLOCK' LIMIT 1);
SET @jfn_asrt = (SELECT id FROM job_functions WHERE code = 'JFN-ASRT' LIMIT 1);

INSERT INTO job_roles (job_function_id, code, name, job_grade_id, job_level_id, description) VALUES
(@jfn_polish, 'JR-KARIGAR', 'Karigar', (SELECT id FROM job_grades WHERE code = 'A' LIMIT 1), (SELECT id FROM job_levels WHERE code = 'L3' LIMIT 1), 'Polishes rough into finished stones'),
(@jfn_polish, 'JR-SR-KARIGAR', 'Senior Karigar', (SELECT id FROM job_grades WHERE code = 'A*' LIMIT 1), (SELECT id FROM job_levels WHERE code = 'L4' LIMIT 1), 'Handles fancy shapes and mentors juniors'),
(@jfn_block, 'JR-BLOCKER', 'Blocking Operator', (SELECT id FROM job_grades WHERE code = 'A+' LIMIT 1), (SELECT id FROM job_levels WHERE code = 'L3' LIMIT 1), 'Operates blocking machines'),
(@jfn_asrt, 'JR-ASSORTER', 'Assorter', (SELECT id FROM job_grades WHERE code = 'A++' LIMIT 1), (SELECT id FROM job_levels WHERE code = 'L3' LIMIT 1), 'Grades and sorts polished stones')
ON DUPLICATE KEY UPDATE name = VALUES(name);

INSERT INTO career_paths (from_role_id, to_role_id, typical_years, notes) VALUES
((SELECT id FROM job_roles WHERE code = 'JR-KARIGAR' LIMIT 1), (SELECT id FROM job_roles WHERE code = 'JR-SR-KARIGAR' LIMIT 1), 4.0, 'Consistent yield above target on fancy shapes')
ON DUPLICATE KEY UPDATE typical_years = VALUES(typical_years);

-- Teams ---------------------------------------------------------------------------
SET @dept_polish = (SELECT id FROM departments WHERE code = 'DEPT-POLISH' LIMIT 1);
SET @dept_block = (SELECT id FROM departments WHERE code = 'DEPT-BLOCK' LIMIT 1);
SET @dept_asrt = (SELECT id FROM departments WHERE code = 'DEPT-ASRT' LIMIT 1);

INSERT INTO teams (company_id, department_id, code, name, team_type, capacity, objectives, start_date, created_by) VALUES
(@company_id, @dept_polish, 'TEAM-ALPHA', 'Team Alpha', 'FUNCTIONAL', 8, 'Fancy shape polishing line', '2024-04-01', @admin_id),
(@company_id, @dept_block, 'TEAM-BLOCK', 'Blocking Crew', 'FUNCTIONAL', 6, 'Rough blocking throughput', '2024-04-01', @admin_id),
(@company_id, NULL, 'TEAM-YIELD', 'Yield Improvement', 'CROSS_FUNCTIONAL', 5, 'Reduce weight loss during blocking', '2026-09-01', @admin_id)
ON DUPLICATE KEY UPDATE name = VALUES(name);

-- Backfill employee links from the free-text columns -------------------------------
UPDATE employees SET company_id = @company_id, legal_entity_id = @entity_id, branch_id = @branch_surat,
  region_id = @region_west, business_unit_id = @bu_mfg
WHERE deleted_at IS NULL;

UPDATE employees e JOIN departments d ON d.name = e.department AND d.deleted_at IS NULL
SET e.department_id = d.id, e.division_id = d.division_id, e.cost_center_id = d.cost_center_id
WHERE e.deleted_at IS NULL;

UPDATE employees e JOIN job_grades g ON g.code = e.grade AND g.deleted_at IS NULL
SET e.job_grade_id = g.id WHERE e.deleted_at IS NULL;

UPDATE employees e JOIN locations l ON l.name = e.office_location AND l.deleted_at IS NULL
SET e.location_id = l.id WHERE e.deleted_at IS NULL;

-- Map the existing designation text onto job roles where they line up.
UPDATE employees SET job_role_id = (SELECT id FROM job_roles WHERE code = 'JR-SR-KARIGAR' LIMIT 1) WHERE designation = 'Senior Karigar' AND deleted_at IS NULL;
UPDATE employees SET job_role_id = (SELECT id FROM job_roles WHERE code = 'JR-KARIGAR' LIMIT 1) WHERE designation IN ('Karigar', 'Junior Karigar') AND deleted_at IS NULL;
UPDATE employees SET job_role_id = (SELECT id FROM job_roles WHERE code = 'JR-ASSORTER' LIMIT 1) WHERE designation = 'Assorter' AND deleted_at IS NULL;

-- Department and business unit heads
SET @emp_301 = (SELECT id FROM employees WHERE emp_code = '301' LIMIT 1);
SET @emp_303 = (SELECT id FROM employees WHERE emp_code = '303' LIMIT 1);
SET @emp_306 = (SELECT id FROM employees WHERE emp_code = '306' LIMIT 1);
UPDATE departments SET head_employee_id = @emp_301 WHERE code = 'DEPT-POLISH';
UPDATE departments SET head_employee_id = @emp_303 WHERE code = 'DEPT-BLOCK';
UPDATE departments SET head_employee_id = @emp_306 WHERE code = 'DEPT-ASRT';
UPDATE business_units SET head_employee_id = @emp_301 WHERE code = 'BU-MFG';
UPDATE branches SET manager_employee_id = @emp_301 WHERE code = 'SURAT';
UPDATE teams SET lead_employee_id = @emp_301 WHERE code = 'TEAM-ALPHA';
UPDATE teams SET lead_employee_id = @emp_303 WHERE code = 'TEAM-BLOCK';

-- Team membership from the existing free-text team column
INSERT INTO team_members (team_id, employee_id, role_in_team, joined_on, created_by)
SELECT t.id, e.id, 'Member', e.joined_at, @admin_id
FROM employees e JOIN teams t ON t.name = e.team AND t.deleted_at IS NULL
WHERE e.deleted_at IS NULL AND e.work_status = 'WORKING'
ON DUPLICATE KEY UPDATE role_in_team = VALUES(role_in_team);

-- Positions: one budgeted seat per working employee, plus open vacancies ----------
INSERT INTO positions (company_id, code, title, job_role_id, department_id, branch_id, cost_center_id, job_grade_id, headcount_budgeted, employment_type, status, effective_from, created_by)
SELECT @company_id, CONCAT('POS-', e.emp_code), COALESCE(e.designation, 'Karigar'), e.job_role_id, e.department_id,
       e.branch_id, e.cost_center_id, e.job_grade_id, 1, COALESCE(e.employment_type, 'PERMANENT'), 'FILLED', e.joined_at, @admin_id
FROM employees e
WHERE e.deleted_at IS NULL AND e.work_status = 'WORKING'
ON DUPLICATE KEY UPDATE title = VALUES(title), status = VALUES(status);

UPDATE employees e JOIN positions p ON p.code = CONCAT('POS-', e.emp_code)
SET e.position_id = p.id WHERE e.deleted_at IS NULL;

-- Vacancies matching the open recruitment requisitions
INSERT INTO positions (company_id, code, title, job_role_id, department_id, branch_id, cost_center_id, job_grade_id, headcount_budgeted, employment_type, status, effective_from, created_by) VALUES
(@company_id, 'POS-VAC-POL-01', 'Polishing Karigar (A+)', (SELECT id FROM job_roles WHERE code = 'JR-KARIGAR' LIMIT 1), @dept_polish, @branch_surat, @cc_polish, (SELECT id FROM job_grades WHERE code = 'A+' LIMIT 1), 4, 'PERMANENT', 'OPEN', '2026-06-15', @admin_id),
(@company_id, 'POS-VAC-BLK-01', 'Blocking Operator', (SELECT id FROM job_roles WHERE code = 'JR-BLOCKER' LIMIT 1), @dept_block, @branch_surat, @cc_block, (SELECT id FROM job_grades WHERE code = 'A' LIMIT 1), 2, 'PERMANENT', 'OPEN', '2026-07-01', @admin_id),
(@company_id, 'POS-VAC-ASR-01', 'Assortment Assistant', (SELECT id FROM job_roles WHERE code = 'JR-ASSORTER' LIMIT 1), @dept_asrt, @branch_surat, @cc_asrt, (SELECT id FROM job_grades WHERE code = 'B' LIMIT 1), 1, 'CONTRACT', 'ON_HOLD', '2026-05-10', @admin_id)
ON DUPLICATE KEY UPDATE title = VALUES(title);

-- Matrix reporting: the yield team lead has a dotted line to the blocking head
INSERT INTO reporting_relationships (employee_id, manager_employee_id, relationship_type, context, allocation_pct, effective_from, created_by)
SELECT @emp_303, @emp_301, 'DOTTED_LINE', 'Yield improvement initiative', 20.00, '2026-09-01', @admin_id
WHERE @emp_301 IS NOT NULL AND @emp_303 IS NOT NULL;

-- Organization policies
INSERT INTO org_policies (company_id, policy_type, code, name, body, effective_from, created_by) VALUES
(@company_id, 'WORKING_HOURS', 'POL-HOURS', 'Standard working hours', 'General shift runs 09:00 to 19:00 with a one hour break. Sunday is the weekly off.', '2026-04-01', @admin_id),
(@company_id, 'ATTENDANCE', 'POL-ATT', 'Attendance policy', 'Attendance is captured on the biometric machine at the main gate. Missed punches must be reported to HR the same day.', '2026-08-01', @admin_id),
(@company_id, 'LEAVE', 'POL-LEAVE', 'Leave policy', 'Casual 7 days, sick 7 days and privilege 15 days per calendar year. Unused privilege leave does not carry forward.', '2026-01-01', @admin_id),
(@company_id, 'PAYROLL', 'POL-PAY', 'Payroll policy', 'Salary is processed monthly. Piece-rate earnings follow the published rate card, and fixed pay is prorated by attendance.', '2026-04-01', @admin_id),
(@company_id, 'SECURITY', 'POL-SEC', 'Security policy', 'All stones are weighed in and out at each handover. Personal bags are not permitted on the manufacturing floor.', '2026-04-01', @admin_id)
ON DUPLICATE KEY UPDATE name = VALUES(name);

-- Scope the existing holidays to this company (they were company-wide already)
UPDATE holidays SET company_id = @company_id WHERE company_id IS NULL AND deleted_at IS NULL;
