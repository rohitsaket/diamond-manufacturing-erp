-- Seed the employee profile: skills master, skill targets, and full profile
-- records for a few karigars so every profile section has something to show.
SET @admin_id = (SELECT id FROM users WHERE email = 'admin@harene.com' LIMIT 1);
SET @emp_301 = (SELECT id FROM employees WHERE emp_code = '301' LIMIT 1);
SET @emp_302 = (SELECT id FROM employees WHERE emp_code = '302' LIMIT 1);
SET @emp_303 = (SELECT id FROM employees WHERE emp_code = '303' LIMIT 1);

-- Skills master (diamond manufacturing trade skills)
INSERT INTO skills (name, category, description) VALUES
('Diamond Polishing', 'TECHNICAL', 'Wheel polishing of round and fancy shapes'),
('Blocking', 'TECHNICAL', 'Initial 4P/8P blocking of rough stones'),
('Faceting', 'TECHNICAL', 'Crown and pavilion faceting accuracy'),
('Fancy Shape Cutting', 'TECHNICAL', 'Pear, marquise, heart and oval cutting'),
('Laser Sawing', 'TECHNICAL', 'Operating laser sawing equipment'),
('Stone Assortment', 'FUNCTIONAL', 'Grading and sorting by colour and clarity'),
('Quality Inspection', 'FUNCTIONAL', 'Detecting polish lines, naturals and symmetry defects'),
('Yield Optimisation', 'FUNCTIONAL', 'Planning cuts to maximise polished weight'),
('Machine Maintenance', 'TECHNICAL', 'Routine upkeep of tangs and scaifes'),
('Team Coordination', 'SOFT', 'Coordinating lot handover across the floor'),
('Communication', 'SOFT', 'Clear reporting of issues and progress'),
('Attention to Detail', 'SOFT', 'Consistency and care in repetitive precision work')
ON DUPLICATE KEY UPDATE category = VALUES(category);

-- Target ratings per grade, so skill-gap analysis has something to compare with
INSERT INTO skill_targets (grade, skill_id, target_rating)
SELECT 'A*', s.id, 5 FROM skills s WHERE s.name IN ('Diamond Polishing', 'Faceting', 'Fancy Shape Cutting', 'Yield Optimisation')
ON DUPLICATE KEY UPDATE target_rating = VALUES(target_rating);

INSERT INTO skill_targets (grade, skill_id, target_rating)
SELECT 'A+++', s.id, 5 FROM skills s WHERE s.name IN ('Diamond Polishing', 'Faceting', 'Quality Inspection')
ON DUPLICATE KEY UPDATE target_rating = VALUES(target_rating);

INSERT INTO skill_targets (grade, skill_id, target_rating)
SELECT 'A++', s.id, 4 FROM skills s WHERE s.name IN ('Diamond Polishing', 'Blocking', 'Quality Inspection', 'Attention to Detail')
ON DUPLICATE KEY UPDATE target_rating = VALUES(target_rating);

INSERT INTO skill_targets (grade, skill_id, target_rating)
SELECT 'A+', s.id, 4 FROM skills s WHERE s.name IN ('Diamond Polishing', 'Blocking', 'Attention to Detail')
ON DUPLICATE KEY UPDATE target_rating = VALUES(target_rating);

INSERT INTO skill_targets (grade, skill_id, target_rating)
SELECT 'A', s.id, 3 FROM skills s WHERE s.name IN ('Diamond Polishing', 'Blocking', 'Communication')
ON DUPLICATE KEY UPDATE target_rating = VALUES(target_rating);

INSERT INTO skill_targets (grade, skill_id, target_rating)
SELECT 'B', s.id, 2 FROM skills s WHERE s.name IN ('Diamond Polishing', 'Attention to Detail')
ON DUPLICATE KEY UPDATE target_rating = VALUES(target_rating);

-- Extended personal, contact and employment details for the senior karigar
UPDATE employees SET
  preferred_name = 'Jay', marital_status = 'MARRIED', nationality = 'Indian', religion = 'Hindu',
  biography = 'Senior karigar with over a decade on fancy shapes. Mentors junior polishers on yield optimisation.',
  mobile = '+91-9876540001', alternate_mobile = '+91-9825011200',
  personal_email = 'jayesh.arora@example.com', official_email = 'jayesh@harene.com',
  permanent_address = '14 Mahavir Nagar, Katargam, Surat', state = 'Gujarat', country = 'India', postal_code = '395004',
  emergency_contact_relation = 'Spouse', emergency_contact_address = '14 Mahavir Nagar, Katargam, Surat',
  emergency_alt_name = 'Suresh Arora', emergency_alt_phone = '+91-9876500021', emergency_alt_relation = 'Brother',
  medical_contact_name = 'Dr. Shah Clinic', medical_contact_phone = '+91-2612345678',
  employment_type = 'PERMANENT', confirmation_date = '2019-09-15', probation_months = 6, notice_period_days = 30,
  work_location = 'Surat Factory', office_location = 'Polishing Floor 2', job_role = 'Senior Karigar', job_level = 'L4',
  cost_center = 'CC-POLISH-01', payroll_group = 'MONTHLY-A',
  company = 'Harene Diamond', business_unit = 'Manufacturing', division = 'Polishing', section = 'Fancy Shapes',
  team = 'Team Alpha', branch = 'Surat', region = 'West', legal_entity = 'Harene Diamond Pvt Ltd',
  bank_branch = 'Katargam', upi_id = 'jayesh@okhdfcbank', pay_grade = 'PG-4', salary_structure = 'PIECE_RATE_STD',
  gratuity_applicable = true, uan_number = '101234567890'
WHERE id = @emp_301;

UPDATE employees SET
  preferred_name = 'Priya', marital_status = 'SINGLE', nationality = 'Indian',
  mobile = '+91-9876540002', personal_email = 'priya.mehta@example.com', official_email = 'priya@harene.com',
  state = 'Gujarat', country = 'India', postal_code = '395006',
  emergency_contact_relation = 'Father',
  employment_type = 'PERMANENT', confirmation_date = '2021-01-01', probation_months = 6, notice_period_days = 30,
  work_location = 'Surat Factory', job_role = 'Karigar', job_level = 'L3',
  company = 'Harene Diamond', business_unit = 'Manufacturing', division = 'Polishing',
  team = 'Team Alpha', branch = 'Surat', region = 'West', legal_entity = 'Harene Diamond Pvt Ltd',
  pay_grade = 'PG-3'
WHERE id = @emp_302;

UPDATE employees SET
  employment_type = 'PERMANENT', work_location = 'Surat Factory', job_role = 'Karigar', job_level = 'L3',
  company = 'Harene Diamond', business_unit = 'Manufacturing', division = 'Blocking',
  branch = 'Surat', region = 'West', legal_entity = 'Harene Diamond Pvt Ltd', nationality = 'Indian'
WHERE id = @emp_303;

-- Everyone gets the company defaults so the org section is never blank
UPDATE employees SET company = 'Harene Diamond', legal_entity = 'Harene Diamond Pvt Ltd',
  branch = 'Surat', region = 'West', country = 'India'
WHERE company IS NULL AND deleted_at IS NULL;

-- Family
INSERT INTO employee_family (employee_id, relation, full_name, dob, occupation, phone, is_dependent, is_nominee, nominee_share_pct, created_by) VALUES
(@emp_301, 'FATHER', 'Kishanlal Arora', '1958-06-12', 'Retired', '+91-9876500031', true, false, NULL, @admin_id),
(@emp_301, 'MOTHER', 'Kamla Arora', '1962-02-20', 'Homemaker', NULL, true, false, NULL, @admin_id),
(@emp_301, 'SPOUSE', 'Nita Arora', '1990-11-05', 'Teacher', '+91-9876500011', false, true, 60.00, @admin_id),
(@emp_301, 'CHILD', 'Aarav Arora', '2016-03-18', 'Student', NULL, true, true, 40.00, @admin_id),
(@emp_302, 'FATHER', 'Rakesh Mehta', '1965-09-09', 'Shopkeeper', '+91-9876500012', false, true, 100.00, @admin_id);

-- Education
INSERT INTO employee_education (employee_id, level, degree, specialization, institution, board_university, passing_year, grade_value, grade_type, created_by) VALUES
(@emp_301, 'SCHOOL', 'SSC', NULL, 'Nutan Vidyalaya, Surat', 'GSEB', 2004, 68.40, 'PERCENTAGE', @admin_id),
(@emp_301, 'HIGHER_SECONDARY', 'HSC', 'Commerce', 'Nutan Vidyalaya, Surat', 'GSEB', 2006, 61.20, 'PERCENTAGE', @admin_id),
(@emp_301, 'DIPLOMA', 'Diploma in Gemmology', 'Diamond Grading', 'Indian Diamond Institute, Surat', 'IDI', 2008, 7.80, 'CGPA', @admin_id),
(@emp_302, 'HIGHER_SECONDARY', 'HSC', 'Science', 'Sarvajanik School, Surat', 'GSEB', 2012, 74.00, 'PERCENTAGE', @admin_id),
(@emp_302, 'GRADUATION', 'B.Com', 'Accounting', 'Veer Narmad South Gujarat University', 'VNSGU', 2015, 65.50, 'PERCENTAGE', @admin_id);

-- Skill ratings
INSERT INTO employee_skills (employee_id, skill_id, rating, experience_level, years_experience, last_used_year, created_by)
SELECT @emp_301, s.id, 5, 'EXPERT', 12.0, 2026, @admin_id FROM skills s WHERE s.name IN ('Diamond Polishing', 'Fancy Shape Cutting')
ON DUPLICATE KEY UPDATE rating = VALUES(rating);

INSERT INTO employee_skills (employee_id, skill_id, rating, experience_level, years_experience, last_used_year, created_by)
SELECT @emp_301, s.id, 4, 'ADVANCED', 9.0, 2026, @admin_id FROM skills s WHERE s.name IN ('Faceting', 'Yield Optimisation', 'Team Coordination')
ON DUPLICATE KEY UPDATE rating = VALUES(rating);

INSERT INTO employee_skills (employee_id, skill_id, rating, experience_level, years_experience, last_used_year, created_by)
SELECT @emp_302, s.id, 4, 'ADVANCED', 6.0, 2026, @admin_id FROM skills s WHERE s.name IN ('Diamond Polishing', 'Quality Inspection')
ON DUPLICATE KEY UPDATE rating = VALUES(rating);

INSERT INTO employee_skills (employee_id, skill_id, rating, experience_level, years_experience, last_used_year, created_by)
SELECT @emp_302, s.id, 2, 'BEGINNER', 1.0, 2025, @admin_id FROM skills s WHERE s.name IN ('Faceting')
ON DUPLICATE KEY UPDATE rating = VALUES(rating);

-- Certifications
INSERT INTO employee_certifications (employee_id, name, cert_type, issuing_authority, credential_id, issued_on, valid_until, created_by) VALUES
(@emp_301, 'Certified Diamond Grader', 'PROFESSIONAL', 'Indian Diamond Institute', 'IDI-CDG-4471', '2018-05-20', '2028-05-19', @admin_id),
(@emp_301, 'Workplace Safety Level 2', 'TECHNICAL', 'Surat Safety Council', 'SSC-L2-9922', '2025-07-08', '2026-09-30', @admin_id),
(@emp_302, 'Diamond Assortment Basics', 'PROFESSIONAL', 'Indian Diamond Institute', 'IDI-DAB-8814', '2020-11-11', NULL, @admin_id);

-- Languages
INSERT INTO employee_languages (employee_id, language, can_read, can_write, can_speak, proficiency, is_native, created_by) VALUES
(@emp_301, 'Gujarati', true, true, true, 'NATIVE', true, @admin_id),
(@emp_301, 'Hindi', true, true, true, 'FLUENT', false, @admin_id),
(@emp_301, 'English', true, true, false, 'CONVERSATIONAL', false, @admin_id),
(@emp_302, 'Gujarati', true, true, true, 'NATIVE', true, @admin_id),
(@emp_302, 'Hindi', true, true, true, 'PROFICIENT', false, @admin_id),
(@emp_302, 'English', true, true, true, 'PROFICIENT', false, @admin_id);

-- Prior experience
INSERT INTO employee_experience (employee_id, company_name, designation, employment_type, industry, location, from_date, to_date, last_salary, reason_for_leaving, reference_name, reference_phone, created_by) VALUES
(@emp_301, 'Shreeji Gems', 'Karigar', 'PERMANENT', 'Diamond Manufacturing', 'Surat', '2010-04-01', '2015-08-31', 14000.00, 'Better opportunity', 'Mahesh Patel', '+91-9825022001', @admin_id),
(@emp_301, 'Kiran Exports', 'Senior Karigar', 'PERMANENT', 'Diamond Manufacturing', 'Surat', '2015-09-15', '2019-03-10', 21000.00, 'Relocation closer to home', 'Nilesh Shah', '+91-9825022002', @admin_id),
(@emp_302, 'Laxmi Diamonds', 'Trainee Karigar', 'INTERNSHIP', 'Diamond Manufacturing', 'Surat', '2018-06-01', '2020-06-15', 9000.00, 'Completed training', NULL, NULL, @admin_id);

-- Career timeline
INSERT INTO employee_timeline (employee_id, event_type, event_date, title, details, from_value, to_value, amount, recorded_by) VALUES
(@emp_301, 'JOINED', '2019-03-15', 'Joined Harene Diamond', 'Hired as Karigar on the polishing floor', NULL, 'Karigar', NULL, @admin_id),
(@emp_301, 'CONFIRMED', '2019-09-15', 'Confirmed after probation', 'Six month probation completed', NULL, NULL, NULL, @admin_id),
(@emp_301, 'PROMOTION', '2022-04-01', 'Promoted to Senior Karigar', 'Consistent yield above target on fancy shapes', 'Karigar', 'Senior Karigar', NULL, @admin_id),
(@emp_301, 'SALARY_REVISION', '2024-04-01', 'Annual revision', 'Rate card grade upgraded', 'A+', 'A*', NULL, @admin_id),
(@emp_301, 'AWARD', '2025-11-09', 'Best yield of the year', 'Highest average yield across the fancy shape line', NULL, NULL, NULL, @admin_id),
(@emp_301, 'TRAINING', '2026-07-08', 'Workplace safety refresher', 'Annual mandatory safety training', NULL, NULL, NULL, @admin_id),
(@emp_302, 'JOINED', '2020-07-01', 'Joined Harene Diamond', 'Hired as Karigar', NULL, 'Karigar', NULL, @admin_id),
(@emp_302, 'CONFIRMED', '2021-01-01', 'Confirmed after probation', NULL, NULL, NULL, NULL, @admin_id),
(@emp_303, 'JOINED', '2018-11-20', 'Joined Harene Diamond', 'Hired for the blocking line', NULL, 'Karigar', NULL, @admin_id);

-- Profile preferences
INSERT INTO employee_settings (employee_id, profile_visibility, show_birthday, language, theme, updated_by)
SELECT e.id, 'TEAM', true, 'en', 'system', @admin_id FROM employees e WHERE e.deleted_at IS NULL
ON DUPLICATE KEY UPDATE profile_visibility = VALUES(profile_visibility);
