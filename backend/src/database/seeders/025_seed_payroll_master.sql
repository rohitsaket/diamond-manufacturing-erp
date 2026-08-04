-- Payroll master data: currencies, pay cycles, components, structures,
-- tax regimes and slabs, reimbursement types, approval workflows and a bank account.
-- Tax figures are seeded as editable configuration, not legal advice. Verify the
-- slabs against the current Finance Act before running live payroll.
SET @admin_id = (SELECT id FROM users WHERE email = 'admin@harene.com' LIMIT 1);

INSERT INTO currencies (code, name, symbol, decimal_places, is_base, is_active) VALUES
('INR', 'Indian Rupee', '₹', 2, true, true),
('USD', 'US Dollar', '$', 2, false, true),
('AED', 'UAE Dirham', 'د.إ', 2, false, false),
('EUR', 'Euro', '€', 2, false, false)
ON DUPLICATE KEY UPDATE name = VALUES(name);

INSERT INTO exchange_rates (from_currency, to_currency, rate, effective_date, source, created_by) VALUES
('USD', 'INR', 88.50000000, '2026-08-01', 'Manual', @admin_id),
('EUR', 'INR', 95.20000000, '2026-08-01', 'Manual', @admin_id),
('AED', 'INR', 24.10000000, '2026-08-01', 'Manual', @admin_id)
ON DUPLICATE KEY UPDATE rate = VALUES(rate);

INSERT INTO pay_cycles (code, name, frequency, currency, country, company, cutoff_day, pay_day, rounding_mode, lop_basis, is_default, created_by) VALUES
('MONTHLY-STD', 'Monthly Standard', 'MONTHLY', 'INR', 'IN', 'Harene Diamond', 25, 7, 'NEAREST', 'CALENDAR_DAYS', true, @admin_id),
('WEEKLY-KARIGAR', 'Weekly Karigar Payout', 'WEEKLY', 'INR', 'IN', 'Harene Diamond', NULL, NULL, 'NEAREST', 'WORKING_DAYS', false, @admin_id),
('MONTHLY-FIXED26', 'Monthly Fixed 26 Days', 'MONTHLY', 'INR', 'IN', 'Harene Diamond', 25, 7, 'NEAREST', 'FIXED_DAYS', false, @admin_id)
ON DUPLICATE KEY UPDATE name = VALUES(name);

UPDATE pay_cycles SET fixed_days_per_month = 26 WHERE code = 'MONTHLY-FIXED26';

-- Attach existing periods to the default monthly cycle
SET @cycle_monthly = (SELECT id FROM pay_cycles WHERE code = 'MONTHLY-STD' LIMIT 1);
UPDATE salary_periods SET cycle_id = @cycle_monthly WHERE cycle_id IS NULL AND deleted_at IS NULL;

-- Pay components
INSERT INTO pay_components
  (code, name, component_type, category, calculation_type, percent_of, default_percent, default_value, is_taxable, is_pf_applicable, is_esi_applicable, is_prorated, affects_gross, is_statutory, is_system, display_order, created_by)
VALUES
('BASIC', 'Basic Salary', 'EARNING', 'BASIC', 'PERCENT_OF', 'CTC', 50.0000, NULL, true, true, true, true, true, false, true, 10, @admin_id),
('HRA', 'House Rent Allowance', 'EARNING', 'ALLOWANCE', 'PERCENT_OF', 'BASIC', 40.0000, NULL, true, false, true, true, true, false, false, 20, @admin_id),
('DA', 'Dearness Allowance', 'EARNING', 'ALLOWANCE', 'PERCENT_OF', 'BASIC', 10.0000, NULL, true, true, true, true, true, false, false, 30, @admin_id),
('CONVEY', 'Conveyance Allowance', 'EARNING', 'ALLOWANCE', 'FIXED', NULL, NULL, 1600.00, true, false, true, true, true, false, false, 40, @admin_id),
('MEDICAL', 'Medical Allowance', 'EARNING', 'ALLOWANCE', 'FIXED', NULL, NULL, 1250.00, true, false, true, true, true, false, false, 50, @admin_id),
('MEAL', 'Meal Allowance', 'EARNING', 'ALLOWANCE', 'FIXED', NULL, NULL, 1000.00, true, false, true, true, true, false, false, 55, @admin_id),
('TRAVEL', 'Travel Allowance', 'EARNING', 'ALLOWANCE', 'FIXED', NULL, NULL, 0.00, true, false, false, true, true, false, false, 60, @admin_id),
('HOUSING', 'Housing Allowance', 'EARNING', 'ALLOWANCE', 'FIXED', NULL, NULL, 0.00, true, false, false, true, true, false, false, 62, @admin_id),
('SHIFT-ALW', 'Shift Allowance', 'EARNING', 'ALLOWANCE', 'FIXED', NULL, NULL, 0.00, true, false, true, true, true, false, false, 64, @admin_id),
('PROJ-ALW', 'Project Allowance', 'EARNING', 'ALLOWANCE', 'FIXED', NULL, NULL, 0.00, true, false, false, true, true, false, false, 66, @admin_id),
('PERF-ALW', 'Performance Allowance', 'EARNING', 'ALLOWANCE', 'FIXED', NULL, NULL, 0.00, true, false, false, true, true, false, false, 68, @admin_id),
('SPECIAL', 'Special Allowance', 'EARNING', 'ALLOWANCE', 'FORMULA', NULL, NULL, NULL, true, false, true, true, true, false, true, 70, @admin_id),
('PIECE', 'Piece Rate Earnings', 'EARNING', 'BASIC', 'PIECE_RATE', NULL, NULL, NULL, true, true, true, false, true, false, true, 15, @admin_id),
('OT', 'Overtime', 'EARNING', 'OVERTIME', 'ATTENDANCE_BASED', NULL, NULL, NULL, true, false, true, false, true, false, true, 80, @admin_id),
('BONUS', 'Bonus', 'EARNING', 'BONUS', 'MANUAL', NULL, NULL, NULL, true, false, false, false, true, false, true, 90, @admin_id),
('INCENTIVE', 'Incentive', 'EARNING', 'INCENTIVE', 'MANUAL', NULL, NULL, NULL, true, false, false, false, true, false, true, 92, @admin_id),
('VARPAY', 'Variable Pay', 'EARNING', 'VARIABLE_PAY', 'MANUAL', NULL, NULL, NULL, true, false, false, false, true, false, true, 94, @admin_id),
('ARREARS', 'Arrears', 'EARNING', 'ARREARS', 'MANUAL', NULL, NULL, NULL, true, false, false, false, true, false, true, 96, @admin_id),
('REIMB', 'Reimbursement', 'REIMBURSEMENT', 'REIMBURSEMENT', 'MANUAL', NULL, NULL, NULL, false, false, false, false, false, false, true, 98, @admin_id),
('PF', 'Provident Fund', 'DEDUCTION', 'STATUTORY', 'SLAB', NULL, NULL, NULL, false, false, false, false, false, true, true, 200, @admin_id),
('ESI', 'Employee State Insurance', 'DEDUCTION', 'STATUTORY', 'SLAB', NULL, NULL, NULL, false, false, false, false, false, true, true, 210, @admin_id),
('PT', 'Professional Tax', 'DEDUCTION', 'STATUTORY', 'SLAB', NULL, NULL, NULL, false, false, false, false, false, true, true, 220, @admin_id),
('TDS', 'Income Tax (TDS)', 'DEDUCTION', 'STATUTORY', 'SLAB', NULL, NULL, NULL, false, false, false, false, false, true, true, 230, @admin_id),
('LWF', 'Labour Welfare Fund', 'DEDUCTION', 'STATUTORY', 'FIXED', NULL, NULL, 24.00, false, false, false, false, false, true, false, 240, @admin_id),
('LOAN-EMI', 'Loan EMI Recovery', 'DEDUCTION', 'LOAN', 'MANUAL', NULL, NULL, NULL, false, false, false, false, false, false, true, 250, @admin_id),
('ADV-REC', 'Advance Recovery', 'DEDUCTION', 'LOAN', 'MANUAL', NULL, NULL, NULL, false, false, false, false, false, false, true, 260, @admin_id),
('INS-PREM', 'Insurance Premium', 'DEDUCTION', 'OTHER', 'FIXED', NULL, NULL, 0.00, false, false, false, false, false, false, false, 270, @admin_id),
('LWP', 'Leave Without Pay', 'DEDUCTION', 'ATTENDANCE', 'ATTENDANCE_BASED', NULL, NULL, NULL, false, false, false, false, false, false, true, 280, @admin_id),
('EMP-PF', 'Employer PF Contribution', 'EMPLOYER_CONTRIBUTION', 'STATUTORY', 'SLAB', NULL, NULL, NULL, false, false, false, false, false, true, true, 300, @admin_id),
('EMP-ESI', 'Employer ESI Contribution', 'EMPLOYER_CONTRIBUTION', 'STATUTORY', 'SLAB', NULL, NULL, NULL, false, false, false, false, false, true, true, 310, @admin_id)
ON DUPLICATE KEY UPDATE name = VALUES(name), display_order = VALUES(display_order);

-- Salary structures
INSERT INTO salary_structures (code, name, description, currency, country, worker_type, effective_from, created_by) VALUES
('STD-MONTHLY', 'Standard Monthly Staff', 'Basic 50 percent of CTC with HRA, DA and statutory deductions', 'INR', 'IN', NULL, '2026-04-01', @admin_id),
('DHAR-FIXED', 'Fixed Pay Karigar (Dhar)', 'Fixed monthly pay prorated by attendance', 'INR', 'IN', 'DHAR', '2026-04-01', @admin_id),
('PIECE-RATE', 'Piece Rate Karigar', 'Earnings driven by lot labour with statutory deductions', 'INR', 'IN', 'PIECE_RATE', '2026-04-01', @admin_id)
ON DUPLICATE KEY UPDATE name = VALUES(name);

SET @st_std = (SELECT id FROM salary_structures WHERE code = 'STD-MONTHLY' LIMIT 1);
SET @st_dhar = (SELECT id FROM salary_structures WHERE code = 'DHAR-FIXED' LIMIT 1);
SET @st_piece = (SELECT id FROM salary_structures WHERE code = 'PIECE-RATE' LIMIT 1);

INSERT INTO salary_structure_lines (structure_id, component_id, calculation_type, percent_of, percent_value, amount, display_order)
SELECT @st_std, c.id, 'PERCENT_OF', 'CTC', 50.0000, NULL, 10 FROM pay_components c WHERE c.code = 'BASIC'
ON DUPLICATE KEY UPDATE percent_value = VALUES(percent_value);
INSERT INTO salary_structure_lines (structure_id, component_id, calculation_type, percent_of, percent_value, amount, display_order)
SELECT @st_std, c.id, 'PERCENT_OF', 'BASIC', 40.0000, NULL, 20 FROM pay_components c WHERE c.code = 'HRA'
ON DUPLICATE KEY UPDATE percent_value = VALUES(percent_value);
INSERT INTO salary_structure_lines (structure_id, component_id, calculation_type, percent_of, percent_value, amount, display_order)
SELECT @st_std, c.id, 'PERCENT_OF', 'BASIC', 10.0000, NULL, 30 FROM pay_components c WHERE c.code = 'DA'
ON DUPLICATE KEY UPDATE percent_value = VALUES(percent_value);
INSERT INTO salary_structure_lines (structure_id, component_id, calculation_type, percent_of, percent_value, amount, display_order)
SELECT @st_std, c.id, 'FIXED', NULL, NULL, 1600.00, 40 FROM pay_components c WHERE c.code = 'CONVEY'
ON DUPLICATE KEY UPDATE amount = VALUES(amount);
INSERT INTO salary_structure_lines (structure_id, component_id, calculation_type, percent_of, percent_value, amount, display_order)
SELECT @st_std, c.id, 'FIXED', NULL, NULL, 1250.00, 50 FROM pay_components c WHERE c.code = 'MEDICAL'
ON DUPLICATE KEY UPDATE amount = VALUES(amount);
INSERT INTO salary_structure_lines (structure_id, component_id, calculation_type, percent_of, percent_value, amount, display_order)
SELECT @st_std, c.id, 'FORMULA', NULL, NULL, NULL, 70 FROM pay_components c WHERE c.code = 'SPECIAL'
ON DUPLICATE KEY UPDATE display_order = VALUES(display_order);

INSERT INTO salary_structure_lines (structure_id, component_id, calculation_type, percent_of, percent_value, amount, display_order)
SELECT @st_dhar, c.id, 'PERCENT_OF', 'CTC', 100.0000, NULL, 10 FROM pay_components c WHERE c.code = 'BASIC'
ON DUPLICATE KEY UPDATE percent_value = VALUES(percent_value);

INSERT INTO salary_structure_lines (structure_id, component_id, calculation_type, percent_of, percent_value, amount, display_order)
SELECT @st_piece, c.id, 'PIECE_RATE', NULL, NULL, NULL, 15 FROM pay_components c WHERE c.code = 'PIECE'
ON DUPLICATE KEY UPDATE display_order = VALUES(display_order);

-- Tax regimes for FY 2026-27
INSERT INTO tax_regimes (code, name, country, financial_year, standard_deduction, rebate_limit, rebate_amount, cess_pct, allows_exemptions, is_default, is_active) VALUES
('NEW', 'New Regime (default)', 'IN', '2026-2027', 75000.00, 1200000.00, 60000.00, 4.00, false, true, true),
('OLD', 'Old Regime (with exemptions)', 'IN', '2026-2027', 50000.00, 500000.00, 12500.00, 4.00, true, false, true)
ON DUPLICATE KEY UPDATE name = VALUES(name), standard_deduction = VALUES(standard_deduction);

SET @regime_new = (SELECT id FROM tax_regimes WHERE code = 'NEW' AND financial_year = '2026-2027' LIMIT 1);
SET @regime_old = (SELECT id FROM tax_regimes WHERE code = 'OLD' AND financial_year = '2026-2027' LIMIT 1);

INSERT INTO tax_slabs (regime_id, from_amount, to_amount, rate_pct, slab_order) VALUES
(@regime_new, 0, 400000, 0.00, 1),
(@regime_new, 400000, 800000, 5.00, 2),
(@regime_new, 800000, 1200000, 10.00, 3),
(@regime_new, 1200000, 1600000, 15.00, 4),
(@regime_new, 1600000, 2000000, 20.00, 5),
(@regime_new, 2000000, 2400000, 25.00, 6),
(@regime_new, 2400000, NULL, 30.00, 7),
(@regime_old, 0, 250000, 0.00, 1),
(@regime_old, 250000, 500000, 5.00, 2),
(@regime_old, 500000, 1000000, 20.00, 3),
(@regime_old, 1000000, NULL, 30.00, 4);

INSERT INTO tax_declaration_sections (code, name, max_limit, limit_group, country) VALUES
('80C', 'Section 80C investments (PF, PPF, LIC, ELSS)', 150000.00, '80C', 'IN'),
('80CCD1B', 'Section 80CCD(1B) NPS additional', 50000.00, NULL, 'IN'),
('80D-SELF', 'Section 80D medical insurance (self and family)', 25000.00, NULL, 'IN'),
('80D-PARENT', 'Section 80D medical insurance (senior parents)', 50000.00, NULL, 'IN'),
('80E', 'Section 80E education loan interest', NULL, NULL, 'IN'),
('80G', 'Section 80G donations', NULL, NULL, 'IN'),
('80TTA', 'Section 80TTA savings account interest', 10000.00, NULL, 'IN'),
('HRA-EXEMPT', 'HRA exemption (rent paid)', NULL, NULL, 'IN'),
('HOME-LOAN-INT', 'Section 24(b) home loan interest', 200000.00, NULL, 'IN')
ON DUPLICATE KEY UPDATE name = VALUES(name), max_limit = VALUES(max_limit);

INSERT INTO reimbursement_types (code, name, annual_limit, monthly_limit, requires_receipt, is_taxable, is_active) VALUES
('MEDICAL-REIMB', 'Medical Reimbursement', 15000.00, NULL, true, false, true),
('TRAVEL-REIMB', 'Travel Reimbursement', NULL, 10000.00, true, false, true),
('FOOD-REIMB', 'Food Reimbursement', NULL, 2200.00, false, false, true),
('INTERNET-REIMB', 'Internet Reimbursement', NULL, 1000.00, true, false, true),
('FUEL-REIMB', 'Fuel Reimbursement', NULL, 5000.00, true, false, true),
('CUSTOM-REIMB', 'Other Claims', NULL, NULL, true, true, true)
ON DUPLICATE KEY UPDATE name = VALUES(name);

INSERT INTO overtime_rules (code, name, ot_kind, rate_type, flat_rate, multiplier, min_minutes, max_hours_per_month, requires_approval, created_by) VALUES
('OT-REG', 'Regular Overtime', 'REGULAR', 'FLAT_HOURLY', 60.00, NULL, 30, 60.00, true, @admin_id),
('OT-WEEKEND', 'Weekend Overtime', 'WEEKEND', 'MULTIPLIER', NULL, 1.500, 30, 40.00, true, @admin_id),
('OT-HOLIDAY', 'Holiday Overtime', 'HOLIDAY', 'MULTIPLIER', NULL, 2.000, 30, 24.00, true, @admin_id),
('OT-NIGHT', 'Night Shift Overtime', 'NIGHT_SHIFT', 'MULTIPLIER', NULL, 1.750, 30, 40.00, true, @admin_id)
ON DUPLICATE KEY UPDATE name = VALUES(name);

INSERT INTO company_bank_accounts (label, bank_name, account_number, ifsc, branch, currency, company, file_format, is_default, created_by) VALUES
('Primary Salary Account', 'HDFC Bank', '50200012345678', 'HDFC0001234', 'Katargam, Surat', 'INR', 'Harene Diamond', 'NEFT', true, @admin_id)
ON DUPLICATE KEY UPDATE bank_name = VALUES(bank_name);

-- Approval workflows
INSERT INTO approval_workflows (code, name, entity_type, min_amount, created_by) VALUES
('WF-PAYROLL', 'Payroll Run Approval', 'PAYROLL_RUN', NULL, @admin_id),
('WF-REVISION', 'Salary Revision Approval', 'SALARY_REVISION', NULL, @admin_id),
('WF-BONUS', 'Bonus Approval', 'BONUS', NULL, @admin_id),
('WF-LOAN', 'Loan Approval', 'LOAN', NULL, @admin_id),
('WF-REIMB', 'Reimbursement Approval', 'REIMBURSEMENT', NULL, @admin_id),
('WF-FNF', 'Final Settlement Approval', 'FINAL_SETTLEMENT', NULL, @admin_id)
ON DUPLICATE KEY UPDATE name = VALUES(name);

INSERT INTO approval_workflow_steps (workflow_id, step_order, name, approver_role, allowed_user_roles, is_mandatory)
SELECT w.id, 1, 'Payroll review', 'PAYROLL_EXECUTIVE', 'admin,accountant', true FROM approval_workflows w WHERE w.code = 'WF-PAYROLL'
ON DUPLICATE KEY UPDATE name = VALUES(name);
INSERT INTO approval_workflow_steps (workflow_id, step_order, name, approver_role, allowed_user_roles, is_mandatory)
SELECT w.id, 2, 'HR approval', 'HR', 'admin,hr', true FROM approval_workflows w WHERE w.code = 'WF-PAYROLL'
ON DUPLICATE KEY UPDATE name = VALUES(name);
INSERT INTO approval_workflow_steps (workflow_id, step_order, name, approver_role, allowed_user_roles, is_mandatory)
SELECT w.id, 3, 'Finance approval', 'FINANCE', 'admin,accountant', true FROM approval_workflows w WHERE w.code = 'WF-PAYROLL'
ON DUPLICATE KEY UPDATE name = VALUES(name);

INSERT INTO approval_workflow_steps (workflow_id, step_order, name, approver_role, allowed_user_roles, is_mandatory)
SELECT w.id, 1, 'HR approval', 'HR', 'admin,hr', true FROM approval_workflows w WHERE w.code IN ('WF-REVISION', 'WF-BONUS', 'WF-FNF')
ON DUPLICATE KEY UPDATE name = VALUES(name);
INSERT INTO approval_workflow_steps (workflow_id, step_order, name, approver_role, allowed_user_roles, is_mandatory)
SELECT w.id, 2, 'Finance approval', 'FINANCE', 'admin,accountant', true FROM approval_workflows w WHERE w.code IN ('WF-REVISION', 'WF-BONUS', 'WF-FNF')
ON DUPLICATE KEY UPDATE name = VALUES(name);

INSERT INTO approval_workflow_steps (workflow_id, step_order, name, approver_role, allowed_user_roles, is_mandatory)
SELECT w.id, 1, 'Finance approval', 'FINANCE', 'admin,accountant', true FROM approval_workflows w WHERE w.code IN ('WF-LOAN', 'WF-REIMB')
ON DUPLICATE KEY UPDATE name = VALUES(name);

INSERT INTO benefit_plans (code, name, benefit_type, provider, employer_contribution, employee_contribution, coverage_amount, currency, effective_from, created_by) VALUES
('GMC-STD', 'Group Medical Cover', 'INSURANCE', 'Star Health', 800.00, 200.00, 300000.00, 'INR', '2026-04-01', @admin_id),
('GPA-STD', 'Group Personal Accident', 'INSURANCE', 'ICICI Lombard', 250.00, 0.00, 500000.00, 'INR', '2026-04-01', @admin_id),
('WELLNESS', 'Annual Health Check-up', 'WELLNESS', 'Apollo Clinic', 1500.00, 0.00, NULL, 'INR', '2026-04-01', @admin_id)
ON DUPLICATE KEY UPDATE name = VALUES(name);
