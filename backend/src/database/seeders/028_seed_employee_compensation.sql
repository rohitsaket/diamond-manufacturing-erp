-- Assign salary structures and compensation to the existing workforce, with a
-- revision history so increment analytics have something real to report.
SET @admin_id = (SELECT id FROM users WHERE email = 'admin@harene.com' LIMIT 1);
SET @st_dhar = (SELECT id FROM salary_structures WHERE code = 'DHAR-FIXED' LIMIT 1);
SET @st_piece = (SELECT id FROM salary_structures WHERE code = 'PIECE-RATE' LIMIT 1);

-- Fixed-pay workers: annual CTC derived from the monthly salary already on record
INSERT INTO employee_salary
  (employee_id, structure_id, currency, annual_ctc, monthly_gross, effective_from, revision_type, revision_reason, status, created_by, updated_by)
SELECT e.id, @st_dhar, 'INR', e.monthly_salary * 12, e.monthly_salary, '2026-04-01', 'INITIAL',
       'Opening compensation on payroll go-live', 'ACTIVE', @admin_id, @admin_id
FROM employees e
WHERE e.worker_type IN ('DHAR', 'MAXI') AND e.monthly_salary IS NOT NULL AND e.deleted_at IS NULL;

-- Piece-rate karigars earn from lot labour, so no fixed CTC is recorded
INSERT INTO employee_salary
  (employee_id, structure_id, currency, annual_ctc, monthly_gross, effective_from, revision_type, revision_reason, status, created_by, updated_by)
SELECT e.id, @st_piece, 'INR', NULL, NULL, '2026-04-01', 'INITIAL',
       'Opening piece-rate assignment', 'ACTIVE', @admin_id, @admin_id
FROM employees e
WHERE e.worker_type = 'PIECE_RATE' AND e.deleted_at IS NULL;

-- A superseded revision plus its replacement, so revision history is not empty
SET @emp_dhar = (SELECT id FROM employees WHERE emp_code = 'DHAR-401' LIMIT 1);

UPDATE employee_salary
SET effective_to = '2026-06-30', status = 'SUPERSEDED', annual_ctc = 240000.00, monthly_gross = 20000.00,
    revision_type = 'INITIAL', revision_reason = 'Opening compensation on payroll go-live'
WHERE employee_id = @emp_dhar AND effective_from = '2026-04-01';

INSERT INTO employee_salary
  (employee_id, structure_id, currency, annual_ctc, monthly_gross, effective_from, revision_type, revision_reason,
   previous_ctc, change_pct, status, approved_by, approved_at, created_by, updated_by)
VALUES
(@emp_dhar, @st_dhar, 'INR', 264000.00, 22000.00, '2026-07-01', 'ANNUAL_REVISION',
 'Annual revision for consistent output and zero absenteeism', 240000.00, 10.00, 'ACTIVE',
 @admin_id, '2026-06-25 11:00:00', @admin_id, @admin_id);

-- Component split for the fixed-pay revisions
INSERT INTO employee_salary_components (employee_salary_id, component_id, amount, percent_value, calculation_type, percent_of)
SELECT es.id, c.id, NULL, 100.0000, 'PERCENT_OF', 'CTC'
FROM employee_salary es
CROSS JOIN pay_components c
WHERE c.code = 'BASIC' AND es.structure_id = @st_dhar
ON DUPLICATE KEY UPDATE percent_value = VALUES(percent_value);

-- Sample bonus, incentive and variable pay awaiting the next payout
SET @emp_301 = (SELECT id FROM employees WHERE emp_code = '301' LIMIT 1);
SET @emp_302 = (SELECT id FROM employees WHERE emp_code = '302' LIMIT 1);
SET @emp_303 = (SELECT id FROM employees WHERE emp_code = '303' LIMIT 1);
SET @period_july = (SELECT id FROM salary_periods WHERE label = 'July 2026' LIMIT 1);
SET @comp_bonus = (SELECT id FROM pay_components WHERE code = 'BONUS' LIMIT 1);
SET @comp_incentive = (SELECT id FROM pay_components WHERE code = 'INCENTIVE' LIMIT 1);
SET @comp_var = (SELECT id FROM pay_components WHERE code = 'VARPAY' LIMIT 1);

INSERT INTO pay_awards
  (employee_id, award_class, award_type, component_id, title, amount, currency, target_value, achieved_value,
   achievement_pct, payout_period_id, effective_date, status, reason, approved_by, approved_at, created_by, updated_by)
VALUES
(@emp_301, 'BONUS', 'PERFORMANCE', @comp_bonus, 'Q1 performance bonus', 12000.00, 'INR', NULL, NULL, NULL,
 @period_july, '2026-07-25', 'APPROVED', 'Highest yield on the fancy shape line', @admin_id, '2026-07-26 10:00:00', @admin_id, @admin_id),
(@emp_302, 'INCENTIVE', 'PRODUCTION', @comp_incentive, 'July production incentive', 4500.00, 'INR', 30.00, 34.50, 115.00,
 @period_july, '2026-07-31', 'APPROVED', 'Exceeded the monthly carat target', @admin_id, '2026-08-01 09:30:00', @admin_id, @admin_id),
(@emp_303, 'VARIABLE_PAY', 'TARGET_ACHIEVEMENT', @comp_var, 'Quarterly variable pay', 8000.00, 'INR', 100.00, 92.00, 92.00,
 @period_july, '2026-07-31', 'PENDING_APPROVAL', 'Quarterly KPI payout pending finance sign-off', NULL, NULL, @admin_id, @admin_id),
(@emp_301, 'BONUS', 'FESTIVAL', @comp_bonus, 'Diwali bonus (provisional)', 18000.00, 'INR', NULL, NULL, NULL,
 NULL, '2026-11-05', 'DRAFT', 'Provisional, subject to the 240 day rule', NULL, NULL, @admin_id, @admin_id);

-- A live loan with its EMI schedule generated on approval by the service layer
INSERT INTO employee_loans
  (employee_id, loan_type, principal, interest_rate_pct, tenure_months, emi_amount, currency, disbursed_on,
   first_emi_date, purpose, status, approved_by, approved_at, created_by, updated_by)
VALUES
(@emp_303, 'MEDICAL', 60000.00, 6.000, 12, 5163.00, 'INR', '2026-06-10', '2026-07-01',
 'Family medical treatment', 'ACTIVE', @admin_id, '2026-06-08 12:00:00', @admin_id, @admin_id);

-- Reimbursement claims
SET @type_medical = (SELECT id FROM reimbursement_types WHERE code = 'MEDICAL-REIMB' LIMIT 1);
SET @type_travel = (SELECT id FROM reimbursement_types WHERE code = 'TRAVEL-REIMB' LIMIT 1);

INSERT INTO reimbursement_claims
  (employee_id, type_id, claim_no, amount, approved_amount, currency, expense_date, description, status,
   payout_period_id, decided_by, decided_at, created_by)
VALUES
(@emp_301, @type_travel, 'RMB-20260718-0001', 850.00, 850.00, 'INR', '2026-07-18',
 'Auto fare for a rush lot delivery', 'APPROVED', @period_july, @admin_id, '2026-07-20 11:00:00', @admin_id),
(@emp_302, @type_medical, 'RMB-20260722-0002', 3200.00, NULL, 'INR', '2026-07-22',
 'Clinic charges after an on-site injury', 'PENDING_APPROVAL', NULL, NULL, NULL, @admin_id);

-- Benefit enrolments for the whole working roster
INSERT INTO employee_benefits (employee_id, plan_id, enrolled_on, employee_contribution, employer_contribution, status, created_by)
SELECT e.id, p.id, '2026-04-01', p.employee_contribution, p.employer_contribution, 'ACTIVE', @admin_id
FROM employees e
CROSS JOIN benefit_plans p
WHERE e.work_status = 'WORKING' AND e.deleted_at IS NULL AND p.code IN ('GMC-STD', 'GPA-STD')
ON DUPLICATE KEY UPDATE status = VALUES(status);

-- Tax declarations for the current financial year
SET @regime_new = (SELECT id FROM tax_regimes WHERE code = 'NEW' AND financial_year = '2026-2027' LIMIT 1);
SET @regime_old = (SELECT id FROM tax_regimes WHERE code = 'OLD' AND financial_year = '2026-2027' LIMIT 1);

INSERT INTO tax_declarations (employee_id, financial_year, regime_id, status, submitted_at, verified_by, verified_at)
VALUES
(@emp_301, '2026-2027', @regime_old, 'VERIFIED', '2026-05-10 10:00:00', @admin_id, '2026-05-15 12:00:00'),
(@emp_302, '2026-2027', @regime_new, 'SUBMITTED', '2026-05-12 14:00:00', NULL, NULL);

SET @decl_301 = (SELECT id FROM tax_declarations WHERE employee_id = @emp_301 AND financial_year = '2026-2027' LIMIT 1);
SET @sec_80c = (SELECT id FROM tax_declaration_sections WHERE code = '80C' LIMIT 1);
SET @sec_80d = (SELECT id FROM tax_declaration_sections WHERE code = '80D-SELF' LIMIT 1);

INSERT INTO tax_declaration_items (declaration_id, section_id, declared_amount, proof_amount, approved_amount, proof_status)
VALUES
(@decl_301, @sec_80c, 150000.00, 150000.00, 150000.00, 'APPROVED'),
(@decl_301, @sec_80d, 25000.00, 22000.00, 22000.00, 'APPROVED');
