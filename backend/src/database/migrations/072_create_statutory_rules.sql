-- State-wise statutory rules. Professional tax and labour welfare fund differ by
-- state, so they live in tables rather than a settings blob.
CREATE TABLE IF NOT EXISTS pt_state_rules (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  state_code VARCHAR(10) NOT NULL,
  state_name VARCHAR(80) NOT NULL,
  country CHAR(2) NOT NULL DEFAULT 'IN',
  effective_from DATE NOT NULL,
  effective_to DATE NULL,
-- Some states bill monthly, some half-yearly, some annually.
  frequency ENUM('MONTHLY', 'HALF_YEARLY', 'ANNUAL') NOT NULL DEFAULT 'MONTHLY',
-- Gender-specific exemption thresholds exist in a few states.
  gender_applicability ENUM('ALL', 'MALE', 'FEMALE') NOT NULL DEFAULT 'ALL',
  annual_cap DECIMAL(10, 2) NULL,
  filing_due_day TINYINT UNSIGNED NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  notes VARCHAR(500) NULL,
  created_by INT UNSIGNED NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP NULL,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_pt_rules_state (state_code, effective_from),
  INDEX idx_pt_rules_deleted_at (deleted_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS pt_state_slabs (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  rule_id INT UNSIGNED NOT NULL,
  from_amount DECIMAL(12, 2) NOT NULL DEFAULT 0,
  to_amount DECIMAL(12, 2) NULL,
  tax_amount DECIMAL(10, 2) NOT NULL DEFAULT 0,
-- Several states charge a different amount in one specific month (often February).
  special_month TINYINT UNSIGNED NULL,
  special_month_amount DECIMAL(10, 2) NULL,
  slab_order INT UNSIGNED NOT NULL DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (rule_id) REFERENCES pt_state_rules(id) ON DELETE CASCADE,
  INDEX idx_pt_slabs_rule (rule_id, slab_order)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS lwf_state_rules (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  state_code VARCHAR(10) NOT NULL,
  state_name VARCHAR(80) NOT NULL,
  country CHAR(2) NOT NULL DEFAULT 'IN',
  effective_from DATE NOT NULL,
  effective_to DATE NULL,
  frequency ENUM('MONTHLY', 'HALF_YEARLY', 'ANNUAL') NOT NULL DEFAULT 'HALF_YEARLY',
  employee_contribution DECIMAL(10, 2) NOT NULL DEFAULT 0,
  employer_contribution DECIMAL(10, 2) NOT NULL DEFAULT 0,
  wage_ceiling DECIMAL(12, 2) NULL,
-- Months in which the deduction is taken, as a comma separated list (6,12).
  deduction_months VARCHAR(40) NULL,
  filing_due_day TINYINT UNSIGNED NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  notes VARCHAR(500) NULL,
  created_by INT UNSIGNED NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP NULL,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE KEY uk_lwf_state_period (state_code, effective_from),
  INDEX idx_lwf_rules_deleted_at (deleted_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- PF / ESI / EPS configuration per legal entity and effective period.
CREATE TABLE IF NOT EXISTS statutory_config (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  scheme ENUM('PF', 'ESI', 'EPS', 'EDLI', 'GRATUITY') NOT NULL,
  legal_entity VARCHAR(160) NULL,
  country CHAR(2) NOT NULL DEFAULT 'IN',
  effective_from DATE NOT NULL,
  effective_to DATE NULL,
  employee_rate_pct DECIMAL(6, 3) NOT NULL DEFAULT 0,
  employer_rate_pct DECIMAL(6, 3) NOT NULL DEFAULT 0,
  wage_ceiling DECIMAL(12, 2) NULL,
-- EPS diverts part of the employer share, capped at its own ceiling.
  diversion_rate_pct DECIMAL(6, 3) NULL,
  diversion_ceiling DECIMAL(12, 2) NULL,
  admin_charge_pct DECIMAL(6, 3) NULL,
  min_admin_charge DECIMAL(10, 2) NULL,
  gratuity_days_per_year DECIMAL(5, 2) NULL,
  gratuity_denominator DECIMAL(5, 2) NULL,
  gratuity_min_years DECIMAL(4, 2) NULL,
  gratuity_max_amount DECIMAL(14, 2) NULL,
  filing_due_day TINYINT UNSIGNED NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  notes VARCHAR(500) NULL,
  created_by INT UNSIGNED NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP NULL,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_statutory_config_scheme (scheme, effective_from),
  INDEX idx_statutory_config_deleted_at (deleted_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Minimum wage floors, used by the compliance checker.
CREATE TABLE IF NOT EXISTS minimum_wage_rules (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  state_code VARCHAR(10) NOT NULL,
  state_name VARCHAR(80) NOT NULL,
  skill_level ENUM('UNSKILLED', 'SEMI_SKILLED', 'SKILLED', 'HIGHLY_SKILLED') NOT NULL DEFAULT 'SKILLED',
  industry VARCHAR(160) NULL,
  monthly_minimum DECIMAL(12, 2) NOT NULL,
  daily_minimum DECIMAL(10, 2) NULL,
  effective_from DATE NOT NULL,
  effective_to DATE NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_by INT UNSIGNED NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP NULL,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_min_wage_state (state_code, skill_level),
  INDEX idx_min_wage_deleted_at (deleted_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
