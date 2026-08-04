-- Employee compensation assignment and full revision history.
-- One row per revision; the current package is the row whose window covers today.
CREATE TABLE IF NOT EXISTS employee_salary (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  employee_id INT UNSIGNED NOT NULL,
  structure_id INT UNSIGNED NULL,
  currency CHAR(3) NOT NULL DEFAULT 'INR',
  annual_ctc DECIMAL(14, 2) NULL,
  monthly_gross DECIMAL(14, 2) NULL,
  effective_from DATE NOT NULL,
  effective_to DATE NULL,
  revision_type ENUM(
    'INITIAL', 'INCREMENT', 'PROMOTION', 'ANNUAL_REVISION',
    'MARKET_ADJUSTMENT', 'SPECIAL', 'CORRECTION'
  ) NOT NULL DEFAULT 'INITIAL',
  revision_reason VARCHAR(500) NULL,
  previous_ctc DECIMAL(14, 2) NULL,
  change_pct DECIMAL(7, 2) NULL,
  status ENUM('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'ACTIVE', 'SUPERSEDED') NOT NULL DEFAULT 'ACTIVE',
  approved_by INT UNSIGNED NULL,
  approved_at DATETIME NULL,
  created_by INT UNSIGNED NULL,
  updated_by INT UNSIGNED NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP NULL,
  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,
  FOREIGN KEY (structure_id) REFERENCES salary_structures(id) ON DELETE SET NULL,
  FOREIGN KEY (approved_by) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_employee_salary_emp (employee_id, effective_from),
  INDEX idx_employee_salary_status (status),
  INDEX idx_employee_salary_deleted_at (deleted_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Per-component amounts for a given compensation revision.
CREATE TABLE IF NOT EXISTS employee_salary_components (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  employee_salary_id INT UNSIGNED NOT NULL,
  component_id INT UNSIGNED NOT NULL,
  amount DECIMAL(14, 2) NULL,
  percent_value DECIMAL(7, 4) NULL,
  calculation_type ENUM('FIXED', 'PERCENT_OF', 'FORMULA', 'ATTENDANCE_BASED', 'SLAB', 'PIECE_RATE', 'MANUAL') NULL,
  percent_of ENUM('BASIC', 'GROSS', 'CTC', 'NET') NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (employee_salary_id) REFERENCES employee_salary(id) ON DELETE CASCADE,
  FOREIGN KEY (component_id) REFERENCES pay_components(id) ON DELETE CASCADE,
  UNIQUE KEY uk_salary_component (employee_salary_id, component_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
