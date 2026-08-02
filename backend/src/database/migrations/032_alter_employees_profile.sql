-- Extend employees with the full HR profile: personal, contact, employment,
-- organization, bank and payroll attributes.

-- Personal information
ALTER TABLE employees ADD COLUMN preferred_name VARCHAR(100) NULL;
ALTER TABLE employees ADD COLUMN marital_status ENUM('SINGLE', 'MARRIED', 'DIVORCED', 'WIDOWED', 'OTHER') NULL;
ALTER TABLE employees ADD COLUMN nationality VARCHAR(80) NULL;
ALTER TABLE employees ADD COLUMN religion VARCHAR(80) NULL;
ALTER TABLE employees ADD COLUMN has_disability BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE employees ADD COLUMN disability_details VARCHAR(255) NULL;
ALTER TABLE employees ADD COLUMN biography TEXT NULL;

-- Statutory and identity documents
ALTER TABLE employees ADD COLUMN passport_number VARCHAR(20) NULL;
ALTER TABLE employees ADD COLUMN passport_expiry DATE NULL;
ALTER TABLE employees ADD COLUMN visa_number VARCHAR(30) NULL;
ALTER TABLE employees ADD COLUMN visa_expiry DATE NULL;
ALTER TABLE employees ADD COLUMN driving_license VARCHAR(30) NULL;
ALTER TABLE employees ADD COLUMN voter_id VARCHAR(20) NULL;
ALTER TABLE employees ADD COLUMN tax_id VARCHAR(30) NULL;

-- Contact information
ALTER TABLE employees ADD COLUMN mobile VARCHAR(20) NULL;
ALTER TABLE employees ADD COLUMN alternate_mobile VARCHAR(20) NULL;
ALTER TABLE employees ADD COLUMN personal_email VARCHAR(255) NULL;
ALTER TABLE employees ADD COLUMN official_email VARCHAR(255) NULL;
ALTER TABLE employees ADD COLUMN permanent_address TEXT NULL;
ALTER TABLE employees ADD COLUMN state VARCHAR(100) NULL;
ALTER TABLE employees ADD COLUMN country VARCHAR(100) NULL DEFAULT 'India';
ALTER TABLE employees ADD COLUMN postal_code VARCHAR(12) NULL;
ALTER TABLE employees ADD COLUMN contact_pref_email BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE employees ADD COLUMN contact_pref_sms BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE employees ADD COLUMN contact_pref_whatsapp BOOLEAN NOT NULL DEFAULT true;

-- Emergency contact (a secondary and a medical contact alongside the existing one)
ALTER TABLE employees ADD COLUMN emergency_contact_relation VARCHAR(60) NULL;
ALTER TABLE employees ADD COLUMN emergency_contact_address VARCHAR(255) NULL;
ALTER TABLE employees ADD COLUMN emergency_alt_name VARCHAR(100) NULL;
ALTER TABLE employees ADD COLUMN emergency_alt_phone VARCHAR(20) NULL;
ALTER TABLE employees ADD COLUMN emergency_alt_relation VARCHAR(60) NULL;
ALTER TABLE employees ADD COLUMN medical_contact_name VARCHAR(100) NULL;
ALTER TABLE employees ADD COLUMN medical_contact_phone VARCHAR(20) NULL;

-- Employment details
ALTER TABLE employees ADD COLUMN employment_type ENUM('PERMANENT', 'CONTRACT', 'PROBATION', 'TRAINEE', 'CONSULTANT') NULL;
ALTER TABLE employees ADD COLUMN confirmation_date DATE NULL;
ALTER TABLE employees ADD COLUMN probation_months INT UNSIGNED NULL;
ALTER TABLE employees ADD COLUMN notice_period_days INT UNSIGNED NULL;
ALTER TABLE employees ADD COLUMN retirement_date DATE NULL;
ALTER TABLE employees ADD COLUMN work_location VARCHAR(120) NULL;
ALTER TABLE employees ADD COLUMN office_location VARCHAR(120) NULL;
ALTER TABLE employees ADD COLUMN job_role VARCHAR(120) NULL;
ALTER TABLE employees ADD COLUMN job_level VARCHAR(40) NULL;
ALTER TABLE employees ADD COLUMN hr_partner_id INT UNSIGNED NULL;
ALTER TABLE employees ADD COLUMN cost_center VARCHAR(60) NULL;
ALTER TABLE employees ADD COLUMN payroll_group VARCHAR(60) NULL;

-- Organization placement
ALTER TABLE employees ADD COLUMN company VARCHAR(120) NULL;
ALTER TABLE employees ADD COLUMN business_unit VARCHAR(120) NULL;
ALTER TABLE employees ADD COLUMN division VARCHAR(120) NULL;
ALTER TABLE employees ADD COLUMN section VARCHAR(120) NULL;
ALTER TABLE employees ADD COLUMN team VARCHAR(120) NULL;
ALTER TABLE employees ADD COLUMN branch VARCHAR(120) NULL;
ALTER TABLE employees ADD COLUMN region VARCHAR(120) NULL;
ALTER TABLE employees ADD COLUMN legal_entity VARCHAR(160) NULL;

-- Bank and payroll
ALTER TABLE employees ADD COLUMN bank_branch VARCHAR(120) NULL;
ALTER TABLE employees ADD COLUMN upi_id VARCHAR(80) NULL;
ALTER TABLE employees ADD COLUMN is_salary_account BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE employees ADD COLUMN pay_grade VARCHAR(40) NULL;
ALTER TABLE employees ADD COLUMN salary_structure VARCHAR(80) NULL;
ALTER TABLE employees ADD COLUMN gratuity_applicable BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE employees ADD COLUMN insurance_policy_no VARCHAR(60) NULL;
ALTER TABLE employees ADD COLUMN uan_number VARCHAR(20) NULL;
ALTER TABLE employees ADD COLUMN esic_number VARCHAR(20) NULL;

ALTER TABLE employees ADD CONSTRAINT fk_employees_hr_partner FOREIGN KEY (hr_partner_id) REFERENCES employees(id) ON DELETE SET NULL;
ALTER TABLE employees ADD INDEX idx_employees_employment_type (employment_type);
ALTER TABLE employees ADD INDEX idx_employees_branch (branch);
