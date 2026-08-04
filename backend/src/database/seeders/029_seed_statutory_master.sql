-- Statutory master data: scheme configuration, state rules, registrations,
-- compliance obligations and the automated checklist.
--
-- IMPORTANT: every rate, ceiling, slab and due date below is seeded as EDITABLE
-- CONFIGURATION, not legal advice. Verify each against the current Act, state
-- notification and circular before running live statutory filings.
SET @admin_id = (SELECT id FROM users WHERE email = 'admin@harene.com' LIMIT 1);

-- Scheme configuration
INSERT INTO statutory_config
  (scheme, legal_entity, country, effective_from, employee_rate_pct, employer_rate_pct, wage_ceiling,
   diversion_rate_pct, diversion_ceiling, admin_charge_pct, min_admin_charge,
   gratuity_days_per_year, gratuity_denominator, gratuity_min_years, gratuity_max_amount, filing_due_day, notes, created_by)
VALUES
('PF', 'Harene Diamond Pvt Ltd', 'IN', '2026-04-01', 12.000, 12.000, 15000.00, NULL, NULL, 0.500, 500.00,
 NULL, NULL, NULL, NULL, 15, 'employer_rate_pct is the TOTAL employer share. The EPS diversion is subtracted from it, leaving the EPF portion. Verify against the current EPFO circular.', @admin_id),
('EPS', 'Harene Diamond Pvt Ltd', 'IN', '2026-04-01', 0.000, 8.330, 15000.00, 8.330, 15000.00, NULL, NULL,
 NULL, NULL, NULL, NULL, 15, 'Pension share diverted from the employer PF contribution.', @admin_id),
('EDLI', 'Harene Diamond Pvt Ltd', 'IN', '2026-04-01', 0.000, 0.500, 15000.00, NULL, NULL, NULL, NULL,
 NULL, NULL, NULL, NULL, 15, 'Employees Deposit Linked Insurance.', @admin_id),
('ESI', 'Harene Diamond Pvt Ltd', 'IN', '2026-04-01', 0.750, 3.250, 21000.00, NULL, NULL, NULL, NULL,
 NULL, NULL, NULL, NULL, 15, 'Applies while gross stays within the wage ceiling.', @admin_id),
('GRATUITY', 'Harene Diamond Pvt Ltd', 'IN', '2026-04-01', 0.000, 0.000, NULL, NULL, NULL, NULL, NULL,
 15.00, 26.00, 5.00, 2000000.00, NULL, 'Fifteen days wages per completed year on a twenty six day divisor.', @admin_id);

-- Professional tax, state-wise
INSERT INTO pt_state_rules (state_code, state_name, country, effective_from, frequency, gender_applicability, annual_cap, filing_due_day, notes, created_by) VALUES
('GJ', 'Gujarat', 'IN', '2026-04-01', 'MONTHLY', 'ALL', 2400.00, 15, 'Verify against the Gujarat State Tax on Professions notification.', @admin_id),
('MH', 'Maharashtra', 'IN', '2026-04-01', 'MONTHLY', 'ALL', 2500.00, 31, 'February carries a higher instalment in Maharashtra.', @admin_id),
('KA', 'Karnataka', 'IN', '2026-04-01', 'MONTHLY', 'ALL', 2400.00, 20, 'Verify against the Karnataka Tax on Professions Act.', @admin_id);

SET @pt_gj = (SELECT id FROM pt_state_rules WHERE state_code = 'GJ' LIMIT 1);
SET @pt_mh = (SELECT id FROM pt_state_rules WHERE state_code = 'MH' LIMIT 1);
SET @pt_ka = (SELECT id FROM pt_state_rules WHERE state_code = 'KA' LIMIT 1);

INSERT INTO pt_state_slabs (rule_id, from_amount, to_amount, tax_amount, special_month, special_month_amount, slab_order) VALUES
(@pt_gj, 0, 11999.99, 0.00, NULL, NULL, 1),
(@pt_gj, 12000, NULL, 200.00, NULL, NULL, 2),
(@pt_mh, 0, 7500, 0.00, NULL, NULL, 1),
(@pt_mh, 7500.01, 10000, 175.00, NULL, NULL, 2),
(@pt_mh, 10000.01, NULL, 200.00, 2, 300.00, 3),
(@pt_ka, 0, 24999.99, 0.00, NULL, NULL, 1),
(@pt_ka, 25000, NULL, 200.00, NULL, NULL, 2);

-- Labour welfare fund
INSERT INTO lwf_state_rules (state_code, state_name, country, effective_from, frequency, employee_contribution, employer_contribution, deduction_months, filing_due_day, notes, created_by) VALUES
('GJ', 'Gujarat', 'IN', '2026-04-01', 'HALF_YEARLY', 6.00, 12.00, '6,12', 31, 'Deducted in June and December. Verify the current notified amounts.', @admin_id),
('MH', 'Maharashtra', 'IN', '2026-04-01', 'HALF_YEARLY', 25.00, 75.00, '6,12', 15, 'Verify against the Maharashtra Labour Welfare Fund Act.', @admin_id);

-- Minimum wage floors used by the compliance checker
INSERT INTO minimum_wage_rules (state_code, state_name, skill_level, industry, monthly_minimum, daily_minimum, effective_from, created_by) VALUES
('GJ', 'Gujarat', 'UNSKILLED', 'Diamond cutting and polishing', 12000.00, 462.00, '2026-04-01', @admin_id),
('GJ', 'Gujarat', 'SEMI_SKILLED', 'Diamond cutting and polishing', 13500.00, 519.00, '2026-04-01', @admin_id),
('GJ', 'Gujarat', 'SKILLED', 'Diamond cutting and polishing', 15000.00, 577.00, '2026-04-01', @admin_id),
('GJ', 'Gujarat', 'HIGHLY_SKILLED', 'Diamond cutting and polishing', 17500.00, 673.00, '2026-04-01', @admin_id);

-- Establishment registrations
INSERT INTO statutory_registrations
  (reg_type, registration_no, legal_entity, company, branch, country, state_code, authority_name, registered_on, contact_person, notes, created_by)
VALUES
('PF', 'GJSRT0123456000', 'Harene Diamond Pvt Ltd', 'Harene Diamond', 'Surat', 'IN', 'GJ', 'EPFO Surat', '2018-04-01', 'HR Manager', 'Sample registration number. Replace with the real establishment code.', @admin_id),
('ESI', '37000123450000101', 'Harene Diamond Pvt Ltd', 'Harene Diamond', 'Surat', 'IN', 'GJ', 'ESIC Surat', '2018-04-01', 'HR Manager', 'Sample registration number. Replace with the real code.', @admin_id),
('PT', 'PT-GJ-SRT-004512', 'Harene Diamond Pvt Ltd', 'Harene Diamond', 'Surat', 'IN', 'GJ', 'Gujarat Commercial Tax', '2018-05-10', 'Accountant', 'Sample enrolment number.', @admin_id),
('LWF', 'LWF-GJ-11223', 'Harene Diamond Pvt Ltd', 'Harene Diamond', 'Surat', 'IN', 'GJ', 'Gujarat Labour Welfare Board', '2019-01-15', 'HR Manager', 'Sample code.', @admin_id),
('TAN', 'SRTH01234F', 'Harene Diamond Pvt Ltd', 'Harene Diamond', 'Surat', 'IN', 'GJ', 'Income Tax Department', '2018-04-01', 'Accountant', 'Sample TAN. Replace with the real one before filing 24Q.', @admin_id);

-- Per-employee statutory enrolment derived from what is already on record
INSERT INTO employee_statutory
  (employee_id, uan, pan, pan_status, pf_status, pf_joined_on, esi_status, esi_joined_on, pt_state_code, lwf_state_code, eps_applicable, gratuity_eligible, created_by)
SELECT
  e.id,
  e.uan_number,
  e.pan,
  CASE WHEN e.pan IS NULL OR e.pan = '' THEN 'NOT_PROVIDED' ELSE 'PROVIDED' END,
  CASE WHEN e.pf_applicable = 1 THEN 'ACTIVE' ELSE 'NOT_ENROLLED' END,
  CASE WHEN e.pf_applicable = 1 THEN e.joined_at ELSE NULL END,
  CASE WHEN e.esi_applicable = 1 THEN 'ACTIVE' ELSE 'NOT_ENROLLED' END,
  CASE WHEN e.esi_applicable = 1 THEN e.joined_at ELSE NULL END,
  'GJ', 'GJ', true, true, @admin_id
FROM employees e
WHERE e.deleted_at IS NULL
ON DUPLICATE KEY UPDATE pf_status = VALUES(pf_status), esi_status = VALUES(esi_status);

UPDATE employee_statutory es
JOIN employees e ON e.id = es.employee_id
SET es.esi_ip_number = e.esic_number
WHERE e.esic_number IS NOT NULL AND e.esic_number <> '';

-- Nominees for the employees who have family on record
INSERT INTO statutory_nominees (employee_id, scheme, nominee_name, relation, share_pct, is_minor, created_by)
SELECT f.employee_id, 'PF', f.full_name, f.relation, f.nominee_share_pct, false, @admin_id
FROM employee_family f
WHERE f.is_nominee = 1 AND f.deleted_at IS NULL;

-- Recurring compliance obligations
INSERT INTO compliance_obligations
  (code, name, category, obligation_type, frequency, country, state_code, authority, due_day, due_month_offset, reminder_days_before, penalty_note, created_by)
VALUES
('PF-ECR-MONTHLY', 'PF ECR upload and contribution payment', 'PF', 'PAYMENT', 'MONTHLY', 'IN', NULL, 'EPFO', 15, 1, 5, 'Interest and damages accrue on late remittance.', @admin_id),
('ESI-CONTRIB-MONTHLY', 'ESI contribution payment', 'ESI', 'PAYMENT', 'MONTHLY', 'IN', NULL, 'ESIC', 15, 1, 5, 'Interest accrues on delayed payment.', @admin_id),
('PT-GJ-MONTHLY', 'Professional tax payment and return (Gujarat)', 'PT', 'PAYMENT', 'MONTHLY', 'IN', 'GJ', 'Gujarat Commercial Tax', 15, 1, 5, 'Penalty applies on late payment.', @admin_id),
('TDS-PAYMENT-MONTHLY', 'TDS deposit on salary', 'TDS', 'PAYMENT', 'MONTHLY', 'IN', NULL, 'Income Tax Department', 7, 1, 3, 'Interest under section 201 applies on late deposit.', @admin_id),
('TDS-24Q-QUARTERLY', 'Quarterly TDS return Form 24Q', 'TDS', 'RETURN', 'QUARTERLY', 'IN', NULL, 'Income Tax Department', 31, 1, 10, 'Late filing fee under section 234E.', @admin_id),
('LWF-GJ-HALFYEARLY', 'Labour welfare fund contribution (Gujarat)', 'LWF', 'PAYMENT', 'HALF_YEARLY', 'IN', 'GJ', 'Gujarat Labour Welfare Board', 31, 1, 10, NULL, @admin_id),
('FORM16-ANNUAL', 'Issue Form 16 to employees', 'TDS', 'DISCLOSURE', 'ANNUAL', 'IN', NULL, 'Income Tax Department', 15, 3, 15, 'Must be issued by 15 June following the financial year.', @admin_id),
('ESI-RETURN-HALFYEARLY', 'ESI half yearly return', 'ESI', 'RETURN', 'HALF_YEARLY', 'IN', NULL, 'ESIC', 11, 2, 10, NULL, @admin_id),
('PF-ANNUAL-RETURN', 'PF annual return', 'PF', 'RETURN', 'ANNUAL', 'IN', NULL, 'EPFO', 30, 2, 15, NULL, @admin_id),
('BONUS-ANNUAL', 'Statutory bonus payment', 'BONUS', 'PAYMENT', 'ANNUAL', 'IN', NULL, 'Labour Department', 30, 8, 30, 'Payable within eight months of the accounting year end.', @admin_id),
('MUSTER-REGISTER', 'Maintain muster roll and wage register', 'LABOUR_LAW', 'REGISTER', 'MONTHLY', 'IN', 'GJ', 'Labour Department', 7, 1, 3, NULL, @admin_id);

-- Compliance checklist. Items with a rule_code are evaluated automatically.
INSERT INTO compliance_checklist_items (code, category, title, description, severity, rule_code, is_automated, display_order) VALUES
('CHK-UAN-MISSING', 'PF', 'Every PF member has a UAN', 'PF contributions cannot be filed in the ECR without a UAN.', 'CRITICAL', 'UAN_MISSING', true, 10),
('CHK-ESI-IP-MISSING', 'ESI', 'Every ESI member has an IP number', 'ESI returns need the insured person number for each covered employee.', 'CRITICAL', 'ESI_IP_MISSING', true, 20),
('CHK-PAN-MISSING', 'TDS', 'Every employee with taxable income has a PAN', 'TDS is deducted at a higher rate when the PAN is absent.', 'HIGH', 'PAN_MISSING', true, 30),
('CHK-BANK-MISSING', 'LABOUR_LAW', 'Every employee has bank details for salary credit', 'Wages must be paid through a bank account.', 'HIGH', 'BANK_MISSING', true, 40),
('CHK-MIN-WAGE', 'MINIMUM_WAGE', 'No employee is paid below the notified minimum wage', 'Compares monthly gross against the state minimum wage for the skill level.', 'CRITICAL', 'BELOW_MINIMUM_WAGE', true, 50),
('CHK-PF-CEILING', 'PF', 'PF wage base respects the statutory ceiling', 'Contributions above the ceiling need an explicit election on record.', 'MEDIUM', 'PF_CEILING_BREACH', true, 60),
('CHK-ESI-ELIGIBILITY', 'ESI', 'ESI coverage matches the wage ceiling', 'Employees crossing the ceiling mid contribution period stay covered until it ends.', 'MEDIUM', 'ESI_ELIGIBILITY', true, 70),
('CHK-CHALLAN-UNPAID', 'PF', 'No statutory challan is overdue and unpaid', 'Interest and damages accrue from the due date.', 'CRITICAL', 'CHALLAN_OVERDUE', true, 80),
('CHK-FILING-OVERDUE', 'LABOUR_LAW', 'No regulatory filing is overdue', 'Late returns attract fees and penalties.', 'CRITICAL', 'FILING_OVERDUE', true, 90),
('CHK-PROOF-PENDING', 'TDS', 'Investment proofs are verified before the final quarter', 'Unverified declarations must be dropped from the TDS computation.', 'HIGH', 'PROOF_PENDING', true, 100),
('CHK-NOMINEE-MISSING', 'PF', 'PF and gratuity nominations are on record', 'Nomination is required under the scheme rules.', 'MEDIUM', 'NOMINEE_MISSING', true, 110),
('CHK-GRATUITY-PROVISION', 'GRATUITY', 'Gratuity liability is provided for', 'The accrued liability should be recognised each year.', 'MEDIUM', NULL, false, 120),
('CHK-BONUS-PAID', 'BONUS', 'Statutory bonus has been paid for the accounting year', 'Payable within eight months of the year end.', 'HIGH', NULL, false, 130),
('CHK-REGISTERS', 'LABOUR_LAW', 'Statutory registers are maintained and current', 'Muster roll, wage register and leave register.', 'MEDIUM', NULL, false, 140);
