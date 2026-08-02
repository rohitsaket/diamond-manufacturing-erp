-- Enterprise document type master. `legacy_doc_type` links each entry back to
-- the original employee_documents.doc_type enum so existing rows keep working.
SET @admin_id = (SELECT id FROM users WHERE email = 'admin@harene.com' LIMIT 1);

INSERT INTO document_types
  (code, name, category, country, legacy_doc_type, is_mandatory, requires_expiry, requires_verification, requires_approval, allows_multiple, retention_months, renewal_reminder_days, max_file_mb, is_confidential, sort_order, created_by)
VALUES
-- 1. Government identity ------------------------------------------------------
('AADHAAR', 'Aadhaar card', 'GOVERNMENT_ID', 'IN', 'AADHAAR', true, false, true, false, false, 96, 30, 5, true, 10, @admin_id),
('PAN', 'PAN card', 'GOVERNMENT_ID', 'IN', 'PAN', true, false, true, false, false, 96, 30, 5, true, 11, @admin_id),
('PASSPORT', 'Passport', 'GOVERNMENT_ID', NULL, 'PASSPORT', false, true, true, false, false, 120, 180, 10, true, 12, @admin_id),
('VISA', 'Visa', 'GOVERNMENT_ID', NULL, 'VISA', false, true, true, true, true, 120, 90, 10, true, 13, @admin_id),
('DRIVING_LICENSE', 'Driving licence', 'GOVERNMENT_ID', NULL, 'DRIVING_LICENSE', false, true, true, false, false, 96, 60, 5, true, 14, @admin_id),
('VOTER_ID', 'Voter ID', 'GOVERNMENT_ID', 'IN', 'VOTER_ID', false, false, true, false, false, 96, 30, 5, true, 15, @admin_id),
('NATIONAL_ID', 'National ID', 'GOVERNMENT_ID', NULL, 'OTHER', false, true, true, false, false, 96, 60, 5, true, 16, @admin_id),
('SSN', 'Social security number', 'GOVERNMENT_ID', NULL, 'OTHER', false, false, true, false, false, 96, 30, 5, true, 17, @admin_id),
('TIN', 'Tax identification number', 'GOVERNMENT_ID', NULL, 'OTHER', false, false, true, false, false, 96, 30, 5, true, 18, @admin_id),
('WORK_PERMIT', 'Work permit', 'GOVERNMENT_ID', NULL, 'OTHER', false, true, true, true, false, 120, 90, 10, true, 19, @admin_id),
('OCI_PIO', 'OCI / PIO card', 'GOVERNMENT_ID', 'IN', 'OTHER', false, true, true, false, false, 120, 90, 10, true, 20, @admin_id),

-- 2. Personal -----------------------------------------------------------------
('BIRTH_CERTIFICATE', 'Birth certificate', 'PERSONAL', NULL, 'OTHER', false, false, true, false, false, 120, 30, 5, false, 30, @admin_id),
('MARRIAGE_CERTIFICATE', 'Marriage certificate', 'PERSONAL', NULL, 'FAMILY', false, false, true, false, false, 120, 30, 5, false, 31, @admin_id),
('NAME_CHANGE', 'Name change certificate', 'PERSONAL', NULL, 'OTHER', false, false, true, false, false, 120, 30, 5, false, 32, @admin_id),
('ADDRESS_PROOF', 'Address proof', 'PERSONAL', NULL, 'ADDRESS_PROOF', true, false, true, false, true, 60, 30, 5, false, 33, @admin_id),
('PHOTOGRAPH', 'Passport photograph', 'PERSONAL', NULL, 'PHOTO', true, false, false, false, false, 96, 30, 2, false, 34, @admin_id),
('SIGNATURE_SPECIMEN', 'Signature specimen', 'PERSONAL', NULL, 'OTHER', false, false, true, false, false, 96, 30, 2, false, 35, @admin_id),
('BLOOD_GROUP_CERT', 'Blood group certificate', 'PERSONAL', NULL, 'MEDICAL', false, false, false, false, false, 60, 30, 5, false, 36, @admin_id),

-- 3. Education ----------------------------------------------------------------
('EDU_10TH', '10th certificate', 'EDUCATION', NULL, 'EDUCATION', true, false, true, false, false, 120, 30, 5, false, 40, @admin_id),
('EDU_12TH', '12th certificate', 'EDUCATION', NULL, 'EDUCATION', false, false, true, false, false, 120, 30, 5, false, 41, @admin_id),
('EDU_DIPLOMA', 'Diploma certificate', 'EDUCATION', NULL, 'EDUCATION', false, false, true, false, true, 120, 30, 5, false, 42, @admin_id),
('EDU_GRADUATION', 'Graduation degree', 'EDUCATION', NULL, 'EDUCATION', false, false, true, false, true, 120, 30, 5, false, 43, @admin_id),
('EDU_POST_GRAD', 'Post graduation degree', 'EDUCATION', NULL, 'EDUCATION', false, false, true, false, true, 120, 30, 5, false, 44, @admin_id),
('EDU_DOCTORATE', 'Doctorate', 'EDUCATION', NULL, 'EDUCATION', false, false, true, false, true, 120, 30, 5, false, 45, @admin_id),
('EDU_PROFESSIONAL', 'Professional degree', 'EDUCATION', NULL, 'EDUCATION', false, false, true, false, true, 120, 30, 5, false, 46, @admin_id),
('EDU_MARKSHEET', 'Marksheet', 'EDUCATION', NULL, 'EDUCATION', false, false, true, false, true, 120, 30, 5, false, 47, @admin_id),
('EDU_TRANSCRIPT', 'Academic transcript', 'EDUCATION', NULL, 'EDUCATION', false, false, true, false, true, 120, 30, 10, false, 48, @admin_id),
('EDU_PROVISIONAL', 'Provisional certificate', 'EDUCATION', NULL, 'EDUCATION', false, false, true, false, true, 120, 30, 5, false, 49, @admin_id),
('EDU_EQUIVALENCY', 'Educational equivalency certificate', 'EDUCATION', NULL, 'EDUCATION', false, false, true, false, false, 120, 30, 5, false, 50, @admin_id),

-- 4. Professional certifications ----------------------------------------------
('CERT_TECHNICAL', 'Technical certification', 'CERTIFICATION', NULL, 'CERTIFICATE', false, true, true, false, true, 96, 60, 5, false, 60, @admin_id),
('CERT_INDUSTRY', 'Industry certification', 'CERTIFICATION', NULL, 'CERTIFICATE', false, true, true, false, true, 96, 60, 5, false, 61, @admin_id),
('CERT_LICENSE', 'Professional licence', 'CERTIFICATION', NULL, 'CERTIFICATE', false, true, true, true, true, 96, 90, 5, false, 62, @admin_id),
('CERT_GOVERNMENT', 'Government certification', 'CERTIFICATION', NULL, 'CERTIFICATE', false, true, true, false, true, 96, 60, 5, false, 63, @admin_id),
('CERT_SKILL', 'Skill certification', 'CERTIFICATION', NULL, 'CERTIFICATE', false, true, true, false, true, 60, 60, 5, false, 64, @admin_id),

-- 5. Employment ---------------------------------------------------------------
('RESUME', 'Resume', 'EMPLOYMENT', NULL, 'EMPLOYMENT', false, false, false, false, true, 60, 30, 10, false, 70, @admin_id),
('CV', 'Curriculum vitae', 'EMPLOYMENT', NULL, 'EMPLOYMENT', false, false, false, false, true, 60, 30, 10, false, 71, @admin_id),
('OFFER_LETTER', 'Offer letter', 'EMPLOYMENT', NULL, 'EMPLOYMENT', true, false, true, false, false, 120, 30, 5, true, 72, @admin_id),
('APPOINTMENT_LETTER', 'Appointment letter', 'EMPLOYMENT', NULL, 'EMPLOYMENT', true, false, true, false, false, 120, 30, 5, true, 73, @admin_id),
('EMPLOYMENT_CONTRACT', 'Employment contract', 'EMPLOYMENT', NULL, 'AGREEMENT', true, true, true, true, false, 120, 90, 10, true, 74, @admin_id),
('NDA', 'Non-disclosure agreement', 'EMPLOYMENT', NULL, 'AGREEMENT', true, false, true, true, false, 120, 30, 5, true, 75, @admin_id),
('CONFIDENTIALITY', 'Confidentiality agreement', 'EMPLOYMENT', NULL, 'AGREEMENT', false, false, true, true, false, 120, 30, 5, true, 76, @admin_id),
('JOINING_FORM', 'Joining form', 'EMPLOYMENT', NULL, 'EMPLOYMENT', true, false, true, false, false, 120, 30, 5, false, 77, @admin_id),
('PROBATION_CONFIRMATION', 'Probation confirmation letter', 'EMPLOYMENT', NULL, 'EMPLOYMENT', false, false, true, false, false, 120, 30, 5, false, 78, @admin_id),
('PROMOTION_LETTER', 'Promotion letter', 'EMPLOYMENT', NULL, 'EMPLOYMENT', false, false, true, false, true, 120, 30, 5, false, 79, @admin_id),
('TRANSFER_LETTER', 'Transfer letter', 'EMPLOYMENT', NULL, 'EMPLOYMENT', false, false, true, false, true, 120, 30, 5, false, 80, @admin_id),
('SALARY_REVISION_LETTER', 'Salary revision letter', 'EMPLOYMENT', NULL, 'EMPLOYMENT', false, false, true, false, true, 120, 30, 5, true, 81, @admin_id),
('INCREMENT_LETTER', 'Increment letter', 'EMPLOYMENT', NULL, 'EMPLOYMENT', false, false, true, false, true, 120, 30, 5, true, 82, @admin_id),
('WARNING_LETTER', 'Warning letter', 'EMPLOYMENT', NULL, 'EMPLOYMENT', false, false, true, true, true, 120, 30, 5, true, 83, @admin_id),
('APPRECIATION_LETTER', 'Appreciation letter', 'EMPLOYMENT', NULL, 'EMPLOYMENT', false, false, false, false, true, 60, 30, 5, false, 84, @admin_id),
('EXPERIENCE_CERTIFICATE', 'Experience certificate', 'EMPLOYMENT', NULL, 'EXPERIENCE', false, false, true, false, false, 120, 30, 5, false, 85, @admin_id),
('RELIEVING_LETTER', 'Relieving letter', 'EMPLOYMENT', NULL, 'EXPERIENCE', false, false, true, false, false, 120, 30, 5, false, 86, @admin_id),
('EXIT_DOCUMENTS', 'Exit documents', 'EMPLOYMENT', NULL, 'EMPLOYMENT', false, false, true, true, true, 120, 30, 10, true, 87, @admin_id),

-- 6. Prior experience ---------------------------------------------------------
('PREV_OFFER_LETTER', 'Previous offer letter', 'EXPERIENCE', NULL, 'EXPERIENCE', false, false, true, false, true, 96, 30, 5, false, 90, @admin_id),
('PREV_EXPERIENCE_LETTER', 'Previous experience letter', 'EXPERIENCE', NULL, 'EXPERIENCE', false, false, true, false, true, 96, 30, 5, false, 91, @admin_id),
('PREV_PAYSLIPS', 'Previous payslips', 'EXPERIENCE', NULL, 'EXPERIENCE', false, false, true, false, true, 96, 30, 10, true, 92, @admin_id),
('PREV_RELIEVING_LETTER', 'Previous relieving letter', 'EXPERIENCE', NULL, 'EXPERIENCE', false, false, true, false, true, 96, 30, 5, false, 93, @admin_id),
('REFERENCE_LETTER', 'Reference letter', 'EXPERIENCE', NULL, 'EXPERIENCE', false, false, true, false, true, 96, 30, 5, false, 94, @admin_id),
('EMPLOYMENT_VERIFICATION', 'Employment verification', 'EXPERIENCE', NULL, 'EXPERIENCE', false, false, true, true, true, 96, 30, 5, true, 95, @admin_id),

-- 7. Payroll and finance ------------------------------------------------------
('BANK_PASSBOOK', 'Bank passbook', 'PAYROLL_FINANCE', NULL, 'BANK_PASSBOOK', true, false, true, false, false, 96, 30, 5, true, 100, @admin_id),
('CANCELLED_CHEQUE', 'Cancelled cheque', 'PAYROLL_FINANCE', NULL, 'BANK_PASSBOOK', false, false, true, false, false, 96, 30, 5, true, 101, @admin_id),
('SALARY_ACCOUNT_VERIFICATION', 'Salary account verification', 'PAYROLL_FINANCE', NULL, 'BANK_PASSBOOK', false, false, true, false, false, 96, 30, 5, true, 102, @admin_id),
('UPI_DETAILS', 'UPI details', 'PAYROLL_FINANCE', 'IN', 'OTHER', false, false, false, false, false, 60, 30, 2, true, 103, @admin_id),
('PF_DOCUMENTS', 'Provident fund documents', 'PAYROLL_FINANCE', 'IN', 'OTHER', false, false, true, false, true, 120, 30, 10, true, 104, @admin_id),
('ESI_DOCUMENTS', 'ESI documents', 'PAYROLL_FINANCE', 'IN', 'OTHER', false, false, true, false, true, 120, 30, 10, true, 105, @admin_id),
('FORM_16', 'Form 16', 'PAYROLL_FINANCE', 'IN', 'OTHER', false, false, true, false, true, 96, 30, 10, true, 106, @admin_id),
('TAX_DECLARATION', 'Tax declaration', 'PAYROLL_FINANCE', NULL, 'OTHER', false, true, true, false, true, 96, 60, 5, true, 107, @admin_id),
('INVESTMENT_PROOF', 'Investment proof', 'PAYROLL_FINANCE', NULL, 'OTHER', false, true, true, true, true, 96, 60, 10, true, 108, @admin_id),
('INSURANCE_DOCUMENTS', 'Insurance documents', 'PAYROLL_FINANCE', NULL, 'OTHER', false, true, true, false, true, 96, 60, 10, true, 109, @admin_id),
('GRATUITY_DOCUMENTS', 'Gratuity documents', 'PAYROLL_FINANCE', 'IN', 'OTHER', false, false, true, false, true, 120, 30, 10, true, 110, @admin_id),

-- 8. Medical ------------------------------------------------------------------
('MEDICAL_CERTIFICATE', 'Medical certificate', 'MEDICAL', NULL, 'MEDICAL', false, true, true, false, true, 60, 30, 10, true, 120, @admin_id),
('FITNESS_CERTIFICATE', 'Fitness certificate', 'MEDICAL', NULL, 'MEDICAL', false, true, true, false, false, 60, 60, 5, true, 121, @admin_id),
('DISABILITY_CERTIFICATE', 'Disability certificate', 'MEDICAL', NULL, 'MEDICAL', false, false, true, false, false, 120, 30, 5, true, 122, @admin_id),
('VACCINATION_CERTIFICATE', 'Vaccination certificate', 'MEDICAL', NULL, 'MEDICAL', false, false, false, false, true, 60, 30, 5, true, 123, @admin_id),
('HEALTH_INSURANCE_CARD', 'Health insurance card', 'MEDICAL', NULL, 'MEDICAL', false, true, true, false, false, 60, 60, 5, true, 124, @admin_id),
('MEDICAL_REPORT', 'Medical report', 'MEDICAL', NULL, 'MEDICAL', false, false, true, false, true, 60, 30, 20, true, 125, @admin_id),
('EMERGENCY_MEDICAL', 'Emergency medical document', 'MEDICAL', NULL, 'MEDICAL', false, false, false, false, true, 60, 30, 10, true, 126, @admin_id),

-- 9. Immigration --------------------------------------------------------------
('RESIDENCE_PERMIT', 'Residence permit', 'IMMIGRATION', NULL, 'OTHER', false, true, true, true, false, 120, 90, 10, true, 130, @admin_id),
('IMMIGRATION_CLEARANCE', 'Immigration clearance', 'IMMIGRATION', NULL, 'OTHER', false, true, true, true, false, 120, 90, 10, true, 131, @admin_id),
('TRAVEL_AUTHORIZATION', 'Travel authorisation', 'IMMIGRATION', NULL, 'OTHER', false, true, true, false, true, 60, 30, 10, true, 132, @admin_id),

-- 10. Compliance --------------------------------------------------------------
('BACKGROUND_VERIFICATION', 'Background verification', 'COMPLIANCE', NULL, 'OTHER', true, false, true, true, false, 120, 30, 10, true, 140, @admin_id),
('POLICE_VERIFICATION', 'Police verification', 'COMPLIANCE', NULL, 'OTHER', false, true, true, true, false, 120, 90, 10, true, 141, @admin_id),
('KYC', 'KYC pack', 'COMPLIANCE', NULL, 'OTHER', true, false, true, true, false, 120, 30, 10, true, 142, @admin_id),
('AML_COMPLIANCE', 'AML compliance', 'COMPLIANCE', NULL, 'OTHER', false, true, true, true, false, 120, 90, 10, true, 143, @admin_id),
('GDPR_CONSENT', 'Data protection consent', 'COMPLIANCE', NULL, 'OTHER', false, false, true, false, false, 120, 30, 5, false, 144, @admin_id),
('POLICY_ACCEPTANCE', 'Company policy acceptance', 'COMPLIANCE', NULL, 'OTHER', true, false, true, false, false, 120, 30, 5, false, 145, @admin_id),
('CODE_OF_CONDUCT', 'Code of conduct acceptance', 'COMPLIANCE', NULL, 'OTHER', true, false, true, false, false, 120, 30, 5, false, 146, @admin_id),
('ETHICS_DECLARATION', 'Ethics declaration', 'COMPLIANCE', NULL, 'OTHER', false, false, true, false, false, 120, 30, 5, false, 147, @admin_id),
('IT_SECURITY_POLICY', 'IT security policy acceptance', 'COMPLIANCE', NULL, 'OTHER', false, false, true, false, false, 120, 30, 5, false, 148, @admin_id),

-- 11. Signatures --------------------------------------------------------------
('SIG_EMPLOYEE', 'Employee signature', 'SIGNATURE', NULL, 'OTHER', false, false, true, false, false, 120, 30, 2, true, 150, @admin_id),
('SIG_MANAGER', 'Manager signature', 'SIGNATURE', NULL, 'OTHER', false, false, true, false, false, 120, 30, 2, true, 151, @admin_id),
('SIG_HR', 'HR signature', 'SIGNATURE', NULL, 'OTHER', false, false, true, false, false, 120, 30, 2, true, 152, @admin_id),
('ORG_SEAL', 'Organisation seal', 'SIGNATURE', NULL, 'OTHER', false, false, true, false, false, 120, 30, 2, true, 153, @admin_id),

-- 12. HR forms ----------------------------------------------------------------
('FORM_EMPLOYEE_INFO', 'Employee information form', 'HR_FORM', NULL, 'EMPLOYMENT', false, false, true, false, false, 96, 30, 5, false, 160, @admin_id),
('FORM_JOINING', 'Joining form', 'HR_FORM', NULL, 'EMPLOYMENT', false, false, true, false, false, 96, 30, 5, false, 161, @admin_id),
('FORM_EXIT', 'Exit form', 'HR_FORM', NULL, 'EMPLOYMENT', false, false, true, true, false, 120, 30, 5, false, 162, @admin_id),
('FORM_TRANSFER', 'Transfer form', 'HR_FORM', NULL, 'EMPLOYMENT', false, false, true, false, true, 96, 30, 5, false, 163, @admin_id),
('FORM_PROMOTION', 'Promotion form', 'HR_FORM', NULL, 'EMPLOYMENT', false, false, true, false, true, 96, 30, 5, false, 164, @admin_id),
('FORM_LEAVE', 'Leave form', 'HR_FORM', NULL, 'EMPLOYMENT', false, false, false, false, true, 36, 30, 5, false, 165, @admin_id),
('FORM_ASSET_DECLARATION', 'Asset declaration', 'HR_FORM', NULL, 'EMPLOYMENT', false, false, true, false, true, 96, 30, 5, false, 166, @admin_id),
('FORM_ASSET_RETURN', 'Asset return form', 'HR_FORM', NULL, 'EMPLOYMENT', false, false, true, false, true, 96, 30, 5, false, 167, @admin_id),

-- 13. Asset -------------------------------------------------------------------
('ASSET_LAPTOP', 'Laptop allocation', 'ASSET', NULL, 'OTHER', false, false, true, false, true, 96, 30, 5, false, 170, @admin_id),
('ASSET_MOBILE', 'Mobile allocation', 'ASSET', NULL, 'OTHER', false, false, true, false, true, 96, 30, 5, false, 171, @admin_id),
('ASSET_ID_CARD', 'ID card', 'ASSET', NULL, 'OTHER', false, true, true, false, false, 96, 60, 5, false, 172, @admin_id),
('ASSET_ACCESS_CARD', 'Access card', 'ASSET', NULL, 'OTHER', false, true, true, false, false, 96, 60, 5, false, 173, @admin_id),
('ASSET_AGREEMENT', 'Asset agreement', 'ASSET', NULL, 'AGREEMENT', false, false, true, false, true, 96, 30, 5, false, 174, @admin_id),
('ASSET_RETURN_RECEIPT', 'Asset return receipt', 'ASSET', NULL, 'OTHER', false, false, true, false, true, 96, 30, 5, false, 175, @admin_id),

-- 14. Legal -------------------------------------------------------------------
('COURT_ORDER', 'Court order', 'LEGAL', NULL, 'OTHER', false, false, true, true, true, 120, 30, 20, true, 180, @admin_id),
('LEGAL_NOTICE', 'Legal notice', 'LEGAL', NULL, 'OTHER', false, false, true, true, true, 120, 30, 20, true, 181, @admin_id),
('ARBITRATION_AGREEMENT', 'Arbitration agreement', 'LEGAL', NULL, 'AGREEMENT', false, false, true, true, false, 120, 30, 10, true, 182, @admin_id),
('IP_AGREEMENT', 'Intellectual property agreement', 'LEGAL', NULL, 'AGREEMENT', false, false, true, true, false, 120, 30, 10, true, 183, @admin_id),

-- 15. Employee generated ------------------------------------------------------
('SELF_UPLOAD', 'Self uploaded document', 'EMPLOYEE_GENERATED', NULL, 'OTHER', false, false, true, false, true, 60, 30, 10, false, 190, @admin_id),
('CUSTOM_DOCUMENT', 'Custom document', 'EMPLOYEE_GENERATED', NULL, 'OTHER', false, false, true, false, true, 60, 30, 10, false, 191, @admin_id),
('ADDITIONAL_CERTIFICATE', 'Additional certificate', 'EMPLOYEE_GENERATED', NULL, 'CERTIFICATE', false, true, true, false, true, 60, 60, 10, false, 192, @admin_id),
('PORTFOLIO', 'Portfolio', 'EMPLOYEE_GENERATED', NULL, 'OTHER', false, false, false, false, true, 36, 30, 20, false, 193, @admin_id),
('SUPPORTING_DOCUMENT', 'Supporting document', 'EMPLOYEE_GENERATED', NULL, 'OTHER', false, false, false, false, true, 36, 30, 10, false, 194, @admin_id),
('OTHER_DOCUMENT', 'Other', 'OTHER', NULL, 'OTHER', false, false, false, false, true, 36, 30, 10, false, 900, @admin_id)
ON DUPLICATE KEY UPDATE
  name = VALUES(name), category = VALUES(category), is_mandatory = VALUES(is_mandatory),
  requires_expiry = VALUES(requires_expiry), requires_approval = VALUES(requires_approval);

-- Link existing documents to the new master by their legacy enum value.
UPDATE employee_documents d
JOIN document_types t ON t.legacy_doc_type = d.doc_type AND t.deleted_at IS NULL
SET d.document_type_id = t.id
WHERE d.document_type_id IS NULL;

-- India-specific joining requirements, due within 30 days of joining.
INSERT INTO document_requirements (document_type_id, country, is_mandatory, due_days_after_joining, notes, created_by)
SELECT t.id, 'IN', true, 30, 'Required at joining for Indian payroll', @admin_id
FROM document_types t
WHERE t.code IN ('AADHAAR', 'PAN', 'BANK_PASSBOOK', 'PHOTOGRAPH', 'ADDRESS_PROOF', 'EDU_10TH', 'OFFER_LETTER', 'APPOINTMENT_LETTER');
