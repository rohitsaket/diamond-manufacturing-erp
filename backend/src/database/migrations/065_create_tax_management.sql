-- Income tax: slab tables, employee declarations, investment proofs and
-- the computed annual projection that drives monthly TDS.
CREATE TABLE IF NOT EXISTS tax_regimes (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(40) NOT NULL,
  name VARCHAR(160) NOT NULL,
  country CHAR(2) NOT NULL DEFAULT 'IN',
  financial_year VARCHAR(9) NOT NULL,
  standard_deduction DECIMAL(12, 2) NOT NULL DEFAULT 0,
-- Rebate under section 87A style rules: full rebate below this taxable income.
  rebate_limit DECIMAL(12, 2) NULL,
  rebate_amount DECIMAL(12, 2) NULL,
  cess_pct DECIMAL(5, 2) NOT NULL DEFAULT 4,
  allows_exemptions BOOLEAN NOT NULL DEFAULT true,
  is_default BOOLEAN NOT NULL DEFAULT false,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_regime_year (code, financial_year),
  INDEX idx_regimes_year (financial_year, country)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS tax_slabs (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  regime_id INT UNSIGNED NOT NULL,
  from_amount DECIMAL(14, 2) NOT NULL DEFAULT 0,
  to_amount DECIMAL(14, 2) NULL,
  rate_pct DECIMAL(5, 2) NOT NULL DEFAULT 0,
  surcharge_pct DECIMAL(5, 2) NOT NULL DEFAULT 0,
  slab_order INT UNSIGNED NOT NULL DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (regime_id) REFERENCES tax_regimes(id) ON DELETE CASCADE,
  INDEX idx_slabs_regime (regime_id, slab_order)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Investment / exemption sections an employee can declare against.
CREATE TABLE IF NOT EXISTS tax_declaration_sections (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(40) NOT NULL UNIQUE,
  name VARCHAR(200) NOT NULL,
  max_limit DECIMAL(12, 2) NULL,
-- Sections sharing a group compete for one shared cap (e.g. 80C bucket).
  limit_group VARCHAR(40) NULL,
  country CHAR(2) NOT NULL DEFAULT 'IN',
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS tax_declarations (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  employee_id INT UNSIGNED NOT NULL,
  financial_year VARCHAR(9) NOT NULL,
  regime_id INT UNSIGNED NULL,
  status ENUM('DRAFT', 'SUBMITTED', 'VERIFIED', 'REJECTED', 'LOCKED') NOT NULL DEFAULT 'DRAFT',
  submitted_at DATETIME NULL,
  verified_by INT UNSIGNED NULL,
  verified_at DATETIME NULL,
  rejection_reason VARCHAR(500) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,
  FOREIGN KEY (regime_id) REFERENCES tax_regimes(id) ON DELETE SET NULL,
  FOREIGN KEY (verified_by) REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE KEY uk_declaration (employee_id, financial_year),
  INDEX idx_declarations_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS tax_declaration_items (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  declaration_id INT UNSIGNED NOT NULL,
  section_id INT UNSIGNED NOT NULL,
  declared_amount DECIMAL(12, 2) NOT NULL DEFAULT 0,
  proof_amount DECIMAL(12, 2) NOT NULL DEFAULT 0,
  approved_amount DECIMAL(12, 2) NOT NULL DEFAULT 0,
  document_id INT UNSIGNED NULL,
  proof_status ENUM('PENDING', 'SUBMITTED', 'APPROVED', 'REJECTED') NOT NULL DEFAULT 'PENDING',
  remarks VARCHAR(500) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (declaration_id) REFERENCES tax_declarations(id) ON DELETE CASCADE,
  FOREIGN KEY (section_id) REFERENCES tax_declaration_sections(id) ON DELETE CASCADE,
  FOREIGN KEY (document_id) REFERENCES employee_documents(id) ON DELETE SET NULL,
  UNIQUE KEY uk_declaration_section (declaration_id, section_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Annual projection recomputed whenever payroll runs, driving monthly TDS.
CREATE TABLE IF NOT EXISTS tax_computations (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  employee_id INT UNSIGNED NOT NULL,
  financial_year VARCHAR(9) NOT NULL,
  regime_id INT UNSIGNED NULL,
  gross_annual DECIMAL(14, 2) NOT NULL DEFAULT 0,
  exemptions DECIMAL(14, 2) NOT NULL DEFAULT 0,
  standard_deduction DECIMAL(12, 2) NOT NULL DEFAULT 0,
  chapter_via_deductions DECIMAL(14, 2) NOT NULL DEFAULT 0,
  taxable_income DECIMAL(14, 2) NOT NULL DEFAULT 0,
  tax_before_rebate DECIMAL(14, 2) NOT NULL DEFAULT 0,
  rebate DECIMAL(14, 2) NOT NULL DEFAULT 0,
  surcharge DECIMAL(14, 2) NOT NULL DEFAULT 0,
  cess DECIMAL(14, 2) NOT NULL DEFAULT 0,
  total_tax DECIMAL(14, 2) NOT NULL DEFAULT 0,
  tax_paid_to_date DECIMAL(14, 2) NOT NULL DEFAULT 0,
  remaining_tax DECIMAL(14, 2) NOT NULL DEFAULT 0,
  monthly_tds DECIMAL(14, 2) NOT NULL DEFAULT 0,
  months_remaining TINYINT UNSIGNED NOT NULL DEFAULT 12,
  computed_at DATETIME NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,
  FOREIGN KEY (regime_id) REFERENCES tax_regimes(id) ON DELETE SET NULL,
  UNIQUE KEY uk_tax_computation (employee_id, financial_year),
  INDEX idx_tax_computations_fy (financial_year)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
