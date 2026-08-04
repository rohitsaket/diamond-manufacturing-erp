-- Form 16 records. Part A (TDS deposited, from the quarterly returns) is
-- normally downloaded from TRACES. What is generated here are the Part B
-- figures plus an archive of what was issued to whom and when.
CREATE TABLE IF NOT EXISTS form16_records (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  employee_id INT UNSIGNED NOT NULL,
  financial_year VARCHAR(9) NOT NULL,
  assessment_year VARCHAR(9) NULL,
  certificate_no VARCHAR(60) NULL,
  pan VARCHAR(10) NULL,
  tan VARCHAR(20) NULL,
  employer_name VARCHAR(200) NULL,
  regime_code VARCHAR(20) NULL,
  gross_salary DECIMAL(14, 2) NOT NULL DEFAULT 0,
  exempt_allowances DECIMAL(14, 2) NOT NULL DEFAULT 0,
  standard_deduction DECIMAL(12, 2) NOT NULL DEFAULT 0,
  professional_tax DECIMAL(12, 2) NOT NULL DEFAULT 0,
  chapter_via_deductions DECIMAL(14, 2) NOT NULL DEFAULT 0,
  taxable_income DECIMAL(14, 2) NOT NULL DEFAULT 0,
  tax_on_income DECIMAL(14, 2) NOT NULL DEFAULT 0,
  rebate DECIMAL(14, 2) NOT NULL DEFAULT 0,
  surcharge DECIMAL(14, 2) NOT NULL DEFAULT 0,
  cess DECIMAL(14, 2) NOT NULL DEFAULT 0,
  total_tax DECIMAL(14, 2) NOT NULL DEFAULT 0,
  tds_deducted DECIMAL(14, 2) NOT NULL DEFAULT 0,
  tax_payable DECIMAL(14, 2) NOT NULL DEFAULT 0,
  refund_due DECIMAL(14, 2) NOT NULL DEFAULT 0,
-- Part A comes from TRACES. When it has not been attached this stays false and
-- the certificate is explicitly marked as Part B figures only.
  has_part_a BOOLEAN NOT NULL DEFAULT false,
  part_a_document_id INT UNSIGNED NULL,
  is_statutory_signed BOOLEAN NOT NULL DEFAULT false,
  status ENUM('DRAFT', 'GENERATED', 'ISSUED', 'REVISED', 'CANCELLED') NOT NULL DEFAULT 'DRAFT',
  file_name VARCHAR(255) NULL,
  file_path VARCHAR(500) NULL,
  generated_at DATETIME NULL,
  issued_at DATETIME NULL,
  revision_no INT UNSIGNED NOT NULL DEFAULT 0,
  remarks VARCHAR(500) NULL,
  created_by INT UNSIGNED NULL,
  updated_by INT UNSIGNED NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP NULL,
  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,
  FOREIGN KEY (part_a_document_id) REFERENCES employee_documents(id) ON DELETE SET NULL,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE KEY uk_form16 (employee_id, financial_year, revision_no),
  INDEX idx_form16_fy (financial_year, status),
  INDEX idx_form16_deleted_at (deleted_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Who received which certificate, and how.
CREATE TABLE IF NOT EXISTS form16_distributions (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  form16_id INT UNSIGNED NOT NULL,
  channel ENUM('EMAIL', 'DOWNLOAD', 'PRINT') NOT NULL DEFAULT 'EMAIL',
  recipient VARCHAR(255) NULL,
  status ENUM('PENDING', 'SENT', 'FAILED', 'DOWNLOADED') NOT NULL DEFAULT 'PENDING',
  error_message VARCHAR(500) NULL,
  sent_at DATETIME NULL,
  actor_user_id INT UNSIGNED NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (form16_id) REFERENCES form16_records(id) ON DELETE CASCADE,
  FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_form16_dist (form16_id, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Rent and landlord details backing an HRA exemption claim (Form 12BB).
CREATE TABLE IF NOT EXISTS hra_declarations (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  declaration_id INT UNSIGNED NOT NULL,
  employee_id INT UNSIGNED NOT NULL,
  financial_year VARCHAR(9) NOT NULL,
  from_month VARCHAR(7) NOT NULL,
  to_month VARCHAR(7) NOT NULL,
  monthly_rent DECIMAL(12, 2) NOT NULL DEFAULT 0,
  city VARCHAR(120) NULL,
  is_metro BOOLEAN NOT NULL DEFAULT false,
  landlord_name VARCHAR(160) NULL,
  landlord_pan VARCHAR(10) NULL,
  landlord_address VARCHAR(500) NULL,
-- A landlord PAN is required once annual rent crosses the statutory threshold.
  pan_required BOOLEAN NOT NULL DEFAULT false,
  document_id INT UNSIGNED NULL,
  proof_status ENUM('PENDING', 'SUBMITTED', 'APPROVED', 'REJECTED') NOT NULL DEFAULT 'PENDING',
  approved_exemption DECIMAL(14, 2) NOT NULL DEFAULT 0,
  remarks VARCHAR(500) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (declaration_id) REFERENCES tax_declarations(id) ON DELETE CASCADE,
  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,
  FOREIGN KEY (document_id) REFERENCES employee_documents(id) ON DELETE SET NULL,
  INDEX idx_hra_employee (employee_id, financial_year)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Individual proof files attached to a declared investment.
CREATE TABLE IF NOT EXISTS tax_proofs (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  declaration_item_id INT UNSIGNED NULL,
  declaration_id INT UNSIGNED NOT NULL,
  employee_id INT UNSIGNED NOT NULL,
  financial_year VARCHAR(9) NOT NULL,
  proof_type ENUM(
    'INVESTMENT', 'INSURANCE', 'HOME_LOAN', 'RENT_RECEIPT', 'MEDICAL',
    'EDUCATION_LOAN', 'DONATION', 'NPS', 'OTHER'
  ) NOT NULL DEFAULT 'INVESTMENT',
  title VARCHAR(200) NOT NULL,
  claimed_amount DECIMAL(12, 2) NOT NULL DEFAULT 0,
  verified_amount DECIMAL(12, 2) NOT NULL DEFAULT 0,
  document_id INT UNSIGNED NULL,
  status ENUM('SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'PARTIALLY_APPROVED', 'REJECTED') NOT NULL DEFAULT 'SUBMITTED',
  reviewed_by INT UNSIGNED NULL,
  reviewed_at DATETIME NULL,
  review_note VARCHAR(500) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP NULL,
  FOREIGN KEY (declaration_item_id) REFERENCES tax_declaration_items(id) ON DELETE CASCADE,
  FOREIGN KEY (declaration_id) REFERENCES tax_declarations(id) ON DELETE CASCADE,
  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,
  FOREIGN KEY (document_id) REFERENCES employee_documents(id) ON DELETE SET NULL,
  FOREIGN KEY (reviewed_by) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_proofs_declaration (declaration_id, status),
  INDEX idx_proofs_employee (employee_id, financial_year),
  INDEX idx_proofs_deleted_at (deleted_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
